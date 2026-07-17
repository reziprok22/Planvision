import uuid
from django.conf import settings as django_settings
from django.db import models
from django.contrib.auth.models import User


class StoredProject(models.Model):
    """Online-Ablage: pro User dauerhaft gespeicherte .planli-Projekte
    ("In der Cloud speichern"). Die Datei ist das identische, selbst-enthaltende
    Projekt-ZIP wie beim lokalen Speichern — geladen wird sie über denselben
    Pfad wie "Öffnen". Limit pro User: Subscription.max_projects (Gate beim
    Anlegen in cloud_save). Nicht vom projects/-Cleanup berührt."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='stored_projects')
    name = models.CharField(max_length=200)
    size_bytes = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Für die spätere Inaktivitäts-Archivierung (12 Monate) schon mitgeführt.
    last_opened_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.name} ({self.user.username})"

    @property
    def file_path(self):
        return django_settings.CLOUD_PROJECTS_DIR / f'{self.id}.planli'


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Nullable: im BETA_MODE werden Projekte anonym gespeichert
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='projects', null=True, blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Freiwillige Einwilligung, den Plan + Annotationen zur Tool-/KI-Verbesserung
    # in TRAINING_DATA_DIR dauerhaft zu speichern.
    consent_training = models.BooleanField(default=False)
    # Wird vom cleanup_projects-Command gesetzt: Dateien in projects/<uuid>/
    # wurden gelöscht, die DB-Zeile bleibt (für Statistik) erhalten.
    files_deleted = models.BooleanField(default=False)

    def __str__(self):
        username = self.user.username if self.user else 'anonym'
        return f"{self.original_filename} ({username})"


class BugReport(models.Model):
    REPORT_TYPES = [
        ('bug', 'Bug'),
        ('suggestion', 'Verbesserung'),
    ]
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='bug_reports')
    report_type = models.CharField(max_length=20, choices=REPORT_TYPES, default='bug')
    text = models.TextField()
    # Optionale Rückmeldeadresse (v.a. in der Beta-Phase ohne Accounts).
    email = models.EmailField(blank=True)
    page_number = models.IntegerField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    # Clientseitig ausgelesene Systeminfos (Browser/OS/Bildschirm/Viewport/DPR/
    # Zeitzone) zur besseren Nachvollziehbarkeit von Bugs.
    client_info = models.TextField(blank=True)
    project_zip = models.CharField(max_length=500, blank=True)  # Pfad relativ zu BUG_REPORTS_DIR
    screenshot = models.CharField(max_length=500, blank=True)   # Pfad relativ zu BUG_REPORTS_DIR
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        username = self.user.username if self.user else 'unbekannt'
        return f"#{self.pk} [{self.get_report_type_display()}] {username}: {self.text[:50]}"


class FeedbackResponse(models.Model):
    """Strukturiertes Nutzer-Feedback (drei feste Fragen) aus dem Feedback-Modal
    der App. Die erste Antwort pro User verlängert als Dankeschön die Testphase
    auf FEEDBACK_REWARD_DAYS (Variante „einfach": ab heute, kein Code-System).
    Nur mit Login — der User ist damit immer bekannt, SET_NULL greift nur bei
    Konto-Löschung (Feedback bleibt anonymisiert erhalten, wie BugReport)."""

    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='feedback_responses')
    positive = models.TextField('Was ist gut?')
    improve = models.TextField('Was muss verbessert werden?')
    missing = models.TextField('Was fehlt?')
    # Hat genau diese Einsendung die Trial-Verlängerung ausgelöst? (Nur die
    # erste pro User — weiteres Feedback ist willkommen, gibt aber nichts mehr.)
    reward_granted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        username = self.user.username if self.user else 'gelöschtes Konto'
        return f"#{self.pk} {username}: {self.positive[:50]}"


class AnalysisEvent(models.Model):
    """Serverseitiges Beta-Tracking: ein Eintrag pro durchgeführter Seitenanalyse.
    session_key dient als anonymer Besucher-Proxy für die Wiederkehr-Schätzung."""
    created_at = models.DateTimeField(auto_now_add=True)
    session_key = models.CharField(max_length=40, blank=True)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='analysis_events')
    page_number = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Analyse {self.created_at:%Y-%m-%d %H:%M} (Seite {self.page_number})"
