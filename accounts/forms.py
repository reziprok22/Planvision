import re

import iso3166
from django import forms
from django.contrib.auth.forms import (AuthenticationForm, PasswordResetForm,
                                       UserCreationForm)
from django.contrib.auth.models import User

from .emails import send_verification_email
from .models import Subscription


class EmailUserCreationForm(UserCreationForm):
    """Registrierung nur mit E-Mail + Passwort.

    Es bleibt beim Standard-User-Model: der Username wird intern auf die
    (kleingeschriebene) E-Mail gesetzt, damit Djangos Auth unverändert
    funktioniert. Kein sichtbares Username-Feld."""

    email = forms.EmailField(
        label='E-Mail',
        max_length=150,  # Limit des username-Felds, das die E-Mail intern trägt
        widget=forms.EmailInput(attrs={'autocomplete': 'email', 'autofocus': True}),
    )

    class Meta:
        model = User
        fields = ('email',)

    def clean_email(self):
        email = self.cleaned_data['email'].lower()
        existing = User.objects.filter(username__iexact=email).first()
        if existing:
            # is_active=False heisst nicht zwingend "nie bestätigt": im Admin
            # gesperrte Konten tragen dasselbe Flag. Gelöscht (und die
            # Registrierung neu gestartet) wird nur ein nachweislich nie
            # benutztes Konto — sonst könnte ein anonymer POST ein gesperrtes
            # Konto samt Subscription und Cloud-Projekten wegräumen.
            if existing.is_active or existing.last_login is not None:
                raise forms.ValidationError('Mit dieser E-Mail-Adresse existiert bereits ein Konto.')
            # Unbestätigtes altes Konto (Verifikations-Mail nie angeklickt) —
            # Registrierung einfach neu starten statt einer Sackgasse.
            existing.delete()
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        user.username = self.cleaned_data['email']
        user.email = self.cleaned_data['email']
        if commit:
            user.save()
        return user


def _never_confirmed(user):
    """`is_active=False` heisst zweierlei: nie bestätigt ODER im Admin
    gesperrt. Unterschieden wird über `Subscription.email_verified_at` — das
    Feld existiert genau dafür, weil `is_active` auch von Hand gesetzt wird.
    `last_login` als zweites Signal deckt Konten ab, die es schon vor diesem
    Feld gab oder die ein Admin angelegt hat (dieselbe Prüfung wie in
    `EmailUserCreationForm.clean_email`)."""
    if user.last_login is not None:
        return False
    return not Subscription.objects.filter(
        user=user, email_verified_at__isnull=False).exists()


class EmailAuthenticationForm(AuthenticationForm):
    """Login per E-Mail: normalisiert die Eingabe auf Kleinschreibung,
    da Usernames (= E-Mails) kleingeschrieben gespeichert werden."""

    def clean_username(self):
        return self.cleaned_data['username'].lower()

    def confirm_login_allowed(self, user):
        """Die beiden Gründe für `is_active=False` brauchen verschiedene
        Auswege: beim unbestätigten Konto hilft ein neuer Link, beim gesperrten
        nur eine Rückmeldung von uns. Vorher bekamen beide die
        "Bestätigungslink"-Meldung — wer im Admin gesperrt wurde, wartete damit
        auf eine Mail, die nie kommt."""
        if user.is_active:
            return
        if _never_confirmed(user):
            raise forms.ValidationError(
                'Dieses Konto ist noch nicht bestätigt. Bitte klicke auf den '
                'Bestätigungslink, den wir dir per E-Mail geschickt haben. '
                'Keine Mail erhalten? Registriere dich einfach erneut mit '
                'derselben Adresse, dann schicken wir einen neuen Link.',
                code='inactive',
            )
        raise forms.ValidationError(
            'Dieses Konto ist deaktiviert. Bitte melde dich bei '
            'info@planli.net, wenn das ein Irrtum ist.',
            code='inactive',
        )


class EmailPasswordResetForm(PasswordResetForm):
    """Passwort-Reset, der unbestätigte Konten nicht ins Leere laufen lässt.

    Djangos `get_users()` filtert auf `is_active=True`. Wer sich registriert
    und den Bestätigungslink nie angeklickt hat, bekam hier also gar nichts —
    bei einer Seite, die "Link ist unterwegs" sagt, eine stille Sackgasse:
    einloggen ging nicht, Passwort zurücksetzen ging nicht, und dass eine
    erneute Registrierung der Ausweg ist, stand nur auf Seiten, auf denen
    dieser Nutzer längst nicht mehr landet.

    Deshalb hier: Für ein nachweislich nie bestätigtes Konto geht stattdessen
    ein frischer Bestätigungslink raus. Nach aussen bleibt alles gleich (immer
    dieselbe "Falls ein Konto existiert"-Seite), es gibt also weiterhin keine
    Auskunft darüber, ob eine Adresse registriert ist."""

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        request = kwargs.get('request')
        if request is None:  # nur der PasswordResetView-Pfad reicht sie mit
            return
        email = self.cleaned_data['email']
        # `email__iexact` wie Djangos get_users(): ohne hinterlegte Adresse
        # könnten wir ohnehin nichts verschicken.
        for user in User.objects.filter(email__iexact=email, is_active=False):
            if _never_confirmed(user):
                send_verification_email(request, user)


class BillingAddressForm(forms.ModelForm):
    """Rechnungsadresse. Gespeichert wird sie auf der Subscription (nur zur
    Vorbefüllung); verbindlich ist die Kopie auf der Rechnung selbst.

    Name und Firma sind enger begrenzt als ihre Model-Felder (100): die
    QR-Rechnungsnorm erlaubt maximal 70 Zeichen pro Adresszeile, und qrbill
    bricht bei längeren mit ValueError ab — dann gäbe es eine Rechnung, deren
    PDF sich nie erzeugen lässt. Aus demselben Grund wird der Ländercode gegen
    ISO 3166 geprüft, statt jedes Zweizeichen-Kürzel durchzulassen."""

    billing_company = forms.CharField(max_length=70, required=False, label='Firma (optional)')
    billing_name = forms.CharField(max_length=70, label='Name')

    class Meta:
        model = Subscription
        fields = ('billing_company', 'billing_name', 'billing_street',
                  'billing_zip', 'billing_city', 'billing_country')
        labels = {
            # billing_company/billing_name stehen oben als explizite Felder —
            # deren Labels würden hier ignoriert.
            'billing_street': 'Strasse und Nr.',
            'billing_zip': 'PLZ',
            'billing_city': 'Ort',
            'billing_country': 'Land',
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ('billing_name', 'billing_street', 'billing_zip', 'billing_city'):
            self.fields[name].required = True
        self.fields['billing_country'].help_text = 'Ländercode, z.B. CH'

    def clean_billing_country(self):
        code = self.cleaned_data['billing_country'].strip().upper()
        if code not in iso3166.countries_by_alpha2:
            raise forms.ValidationError('Bitte einen gültigen Ländercode angeben, z.B. CH.')
        return code

    def clean(self):
        """PLZ nur für CH/LI streng prüfen (genau 4 Ziffern). Ausländische
        Postleitzahlen sind länger und oft alphanumerisch (NL '1234 AB',
        UK 'SW1A 1AA') — dort begrenzt nur das QR-Norm-Limit von 16 Zeichen
        (max_length des Model-Felds)."""
        cleaned = super().clean()
        if (cleaned.get('billing_country') in ('CH', 'LI')
                and cleaned.get('billing_zip')
                and not re.fullmatch(r'\d{4}', cleaned['billing_zip'])):
            self.add_error('billing_zip', 'Bitte eine vierstellige PLZ angeben.')
        return cleaned

    def address_snapshot(self):
        """Die Adressfelder als Dict für Invoice.objects.create()."""
        return {name: self.cleaned_data[name] for name in self.Meta.fields}
