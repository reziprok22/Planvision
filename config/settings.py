from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-tr22ozcv4ug2_m9w263&zik-6w*s#g3&lll4iv##dds$rms685')

DEBUG = os.environ.get('DJANGO_DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

# Hinter nginx: HTTPS anhand des X-Forwarded-Proto-Headers erkennen
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Erlaubte Origins für CSRF-geschützte POSTs (Upload, Analyse, Bug-Report)
CSRF_TRUSTED_ORIGINS = ['https://planli.net', 'https://www.planli.net']

# Produktions-Härtung (nur wenn DEBUG aus, damit lokal http://localhost
# weiter funktioniert). SECURE_SSL_REDIRECT (check-Warnung W008) bleibt
# bewusst weg: nginx leitet Port 80 schon per 301 auf HTTPS um, Django
# sieht nie einen unverschlüsselten Request.
if not DEBUG:
    SESSION_COOKIE_SECURE = True   # Session-Cookie nur über HTTPS
    CSRF_COOKIE_SECURE = True      # CSRF-Cookie nur über HTTPS
    # HSTS: Browser merken sich, planli.net nur per HTTPS anzusteuern.
    # Konservativ 30 Tage; wenn länger problemlos, auf 31536000 (1 Jahr)
    # erhöhen. Kein includeSubDomains/preload (www hat eigenen Redirect).
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'core',
    'accounts',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'core.context_processors.analytics',
                'core.context_processors.beta_mode',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# SQLite-Tuning für gunicorn mit mehreren Workern:
# - WAL: Leser blockieren Schreiber nicht mehr (Standard-Journal tut das);
#   legt db.sqlite3-wal/-shm neben die DB (gitignored, Backup nutzt eh die
#   Online-Backup-API und ist davon unabhängig)
# - synchronous=NORMAL: empfohlene Paarung mit WAL (volle Integrität bei
#   App-Crash; nur bei OS-/Stromausfall können letzte Commits fehlen)
# - timeout: Schreiber warten bis 20 s auf das Lock statt sofort
#   "database is locked" zu werfen
# - transaction_mode=IMMEDIATE: Schreib-Transaktionen nehmen das Lock sofort
#   statt erst beim ersten Write — verhindert die Lock-Upgrade-Falle, bei
#   der das timeout nicht greift
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        'OPTIONS': {
            'transaction_mode': 'IMMEDIATE',
            'timeout': 20,
            'init_command': (
                'PRAGMA journal_mode=WAL;'
                'PRAGMA synchronous=NORMAL;'
            ),
        },
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Neue Konten sind bis zur E-Mail-Verifikation is_active=False. Das Standard-
# ModelBackend würde solche User beim Login-Versuch schon vor der
# Passwortprüfung stillschweigend verwerfen (generische Fehlermeldung) —
# AllowAllUsersModelBackend lässt sie bis zu confirm_login_allowed()
# (EmailAuthenticationForm) durch, wo die Meldung "Konto noch nicht
# bestätigt" ausgegeben wird.
AUTHENTICATION_BACKENDS = ['django.contrib.auth.backends.AllowAllUsersModelBackend']

LANGUAGE_CODE = 'de-ch'
TIME_ZONE = 'Europe/Zurich'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATICFILES_DIRS = [
    BASE_DIR / 'static',
    ('dist', BASE_DIR / 'dist'),  # served at /static/dist/
]
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

PROJECTS_DIR = BASE_DIR / 'projects'
BUG_REPORTS_DIR = BASE_DIR / 'bug_reports'
# Dauerhaft gespeicherte, freiwillig freigegebene Trainingsdaten (Opt-In).
# Vom projects/-Cleanup unberührt.
TRAINING_DATA_DIR = BASE_DIR / 'training_data_opt-in'
# Aufbewahrungsdauer für projects/<uuid>/ (Arbeits-/Zwischenspeicher).
PROJECT_RETENTION_DAYS = int(os.environ.get('PROJECT_RETENTION_DAYS', 14))

# BETA_MODE: zentraler Schalter für die Beta-Phase. Wenn True, löst er aus:
#   - Kein Login nötig: alle Endpunkte (App, Upload, Analyse, Bug-Reports)
#     funktionieren ohne Anmeldung.
#   - Projekte werden anonym gespeichert (user=NULL); Zugriff nur per
#     unerratbarer Session-UUID statt per Ownership-Prüfung.
#   - In der App erscheint das "Beta"-Badge, auf der Landingpage der Beta-Banner.
# Für den Produktivbetrieb mit Accounts: auf False setzen (beendet die Beta-Phase).
# Lokal testbar via Env: BETA_MODE=False python manage.py runserver
BETA_MODE = os.environ.get('BETA_MODE', 'True') == 'True'

# Kostenlose Testphase ab Registrierung; danach Read-Only bis zur Zahlung
# (accounts.models.Subscription). Preis wie auf der Landingpage.
TRIAL_DAYS = 30
LICENSE_PRICE_CHF = 240
# Feedback-Dankeschön (Akquise-Phase): Wer die drei Feedback-Fragen in der App
# beantwortet, bekommt einmalig eine auf 6 Monate verlängerte Testphase
# (trial_ends = jetzt + FEEDBACK_REWARD_DAYS, siehe core.views.submit_feedback).
FEEDBACK_REWARD_DAYS = 180
# Projektlimit der Online-Ablage: Default für neue User;
# pro User im Admin überschreibbar (Subscription.max_projects, z.B. 100/200).
DEFAULT_MAX_PROJECTS = 50
# Online-Ablage: dauerhaft gespeicherte .planli-Projekte pro User
# (StoredProject). Wie training_data_opt-in nie vom Cleanup berührt.
CLOUD_PROJECTS_DIR = BASE_DIR / 'cloud_projects'
# Stiller technischer Deckel pro Projekt (Ausreisser-Schutz, kein beworbenes Limit)
MAX_PROJECT_MB = 200

LOGIN_URL = '/accounts/login/'
LOGIN_REDIRECT_URL = '/app/'
LOGOUT_REDIRECT_URL = '/accounts/login/'

# E-Mail-Versand (Passwort-Reset). Ohne DJANGO_EMAIL_HOST landen Mails in der
# Konsole (Dev). Für den Server die DJANGO_EMAIL_*-Variablen in der
# systemd-Unit setzen (SMTP-Zugangsdaten des Mail-Anbieters).
if os.environ.get('DJANGO_EMAIL_HOST'):
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = os.environ['DJANGO_EMAIL_HOST']
    EMAIL_PORT = int(os.environ.get('DJANGO_EMAIL_PORT', 587))
    EMAIL_HOST_USER = os.environ.get('DJANGO_EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.environ.get('DJANGO_EMAIL_HOST_PASSWORD', '')
    EMAIL_USE_TLS = os.environ.get('DJANGO_EMAIL_USE_TLS', 'True') == 'True'
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
DEFAULT_FROM_EMAIL = os.environ.get('DJANGO_DEFAULT_FROM_EMAIL', 'Planli <noreply@planli.net>')

# Plausible-Analytics: Domain wie im Plausible-Dashboard angelegt (z. B. 'planli.net').
# Leer = deaktiviert; sobald gesetzt, wird das Tracking-Snippet auf allen Seiten geladen.
PLAUSIBLE_DOMAIN = 'planli.net'

PDF_DPI = 150
JPEG_QUALITY = 70
