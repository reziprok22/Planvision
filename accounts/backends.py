from django.contrib.auth.backends import ModelBackend


class InactiveAwareModelBackend(ModelBackend):
    """Wie Djangos ModelBackend, lässt inaktive Konten aber bis zur
    Formularprüfung durch — und nur dort.

    Warum überhaupt: `EmailAuthenticationForm.confirm_login_allowed()` soll
    erklären können, *warum* der Login nicht geht (Konto noch nicht bestätigt
    bzw. deaktiviert). Dafür muss `authenticate()` den User zurückgeben;
    ModelBackend verwirft ihn schon vor der Passwortprüfung und die Meldung
    bliebe generisch.

    Warum nicht Djangos `AllowAllUsersModelBackend`, das genau dafür da ist:
    Es hebt die `is_active`-Prüfung über `user_can_authenticate()` auf, und
    dieselbe Methode benutzt `ModelBackend.get_user()` — die bei **jedem**
    Request läuft, um die Session aufzulösen. Ein im Admin deaktiviertes Konto
    behielt damit seine laufende Session inklusive vollem Zugriff auf App und
    Cloud-Endpoints, bis das Cookie ablief (Default zwei Wochen). `is_active`
    ist aber der einzige Sperrhebel, den der Admin hat — er muss sofort
    greifen.

    Deshalb die Trennung: offen beim Anmelden, streng bei jedem Request.
    """

    def user_can_authenticate(self, user):
        # Gilt nur für authenticate(): das Urteil fällt confirm_login_allowed().
        return True

    def get_user(self, user_id):
        # Session-Auflösung: hier zählt is_active wieder — Deaktivieren im
        # Admin loggt bestehende Sessions damit sofort aus.
        user = super().get_user(user_id)
        return user if user is not None and user.is_active else None
