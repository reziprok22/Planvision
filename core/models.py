import uuid
from django.db import models
from django.contrib.auth.models import User


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
