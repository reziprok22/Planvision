from django import forms
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth.models import User

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


class EmailAuthenticationForm(AuthenticationForm):
    """Login per E-Mail: normalisiert die Eingabe auf Kleinschreibung,
    da Usernames (= E-Mails) kleingeschrieben gespeichert werden."""

    def clean_username(self):
        return self.cleaned_data['username'].lower()

    def confirm_login_allowed(self, user):
        if not user.is_active:
            raise forms.ValidationError(
                'Dieses Konto ist noch nicht bestätigt. Bitte klicke auf den '
                'Bestätigungslink, den wir dir per E-Mail geschickt haben.',
                code='inactive',
            )


class BillingAddressForm(forms.ModelForm):
    """Rechnungsadresse. Gespeichert wird sie auf der Subscription (nur zur
    Vorbefüllung); verbindlich ist die Kopie auf der Rechnung selbst."""

    class Meta:
        model = Subscription
        fields = ('billing_company', 'billing_name', 'billing_street',
                  'billing_zip', 'billing_city', 'billing_country')
        labels = {
            'billing_company': 'Firma (optional)',
            'billing_name': 'Name',
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

    def address_snapshot(self):
        """Die Adressfelder als Dict für Invoice.objects.create()."""
        return {name: self.cleaned_data[name] for name in self.Meta.fields}
