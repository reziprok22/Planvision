from django.contrib.auth.tokens import PasswordResetTokenGenerator


class EmailVerificationTokenGenerator(PasswordResetTokenGenerator):
    """Wie der Passwort-Reset-Token, aber an is_active statt am Passwort-Hash
    aufgehängt — der Link verfällt damit automatisch, sobald das Konto
    bestätigt wurde (Single-Use), unabhängig vom Passwort-Reset-Token
    (eigener key_salt)."""

    key_salt = 'accounts.tokens.EmailVerificationTokenGenerator'

    def _make_hash_value(self, user, timestamp):
        return f'{user.pk}{user.is_active}{timestamp}{user.email}'


email_verification_token = EmailVerificationTokenGenerator()
