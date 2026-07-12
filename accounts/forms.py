from django import forms
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth.models import User


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
            if existing.is_active:
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
