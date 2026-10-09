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
                'core.context_processors.pricing',
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
# Passwortprüfung stillschweigend verwerfen (generische Fehlermeldung) — das
# eigene Backend lässt sie bis zu confirm_login_allowed()
# (EmailAuthenticationForm) durch, wo die Meldung "Konto noch nicht bestätigt"
# ausgegeben wird. Hier stand dafür bis 20.8.2026 Djangos
# AllowAllUsersModelBackend; das hob die is_active-Prüfung aber auch für
# get_user() auf, sodass ein im Admin deaktiviertes Konto seine laufende
# Session behielt. Siehe accounts/backends.py.
AUTHENTICATION_BACKENDS = ['accounts.backends.InactiveAwareModelBackend']

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

# BETA_MODE: Schalter für anonymen Zugriff (kein Login). Wenn True, löst er aus:
#   - Kein Login nötig: alle Endpunkte (App, Upload, Analyse, Bug-Reports)
#     funktionieren ohne Anmeldung.
#   - Projekte werden anonym gespeichert (user=NULL); Zugriff nur per
#     unerratbarer Session-UUID statt per Ownership-Prüfung.
# Ab False (jetzt Default) verlangt /app ein Login (ausser ?demo=1) — die
# Online-Ablage ("Meine Projekte") braucht ohnehin immer ein Konto und war in
# der Beta sonst mangels Login-Einstieg für niemanden erreichbar.
# Lokal testbar via Env: BETA_MODE=True python manage.py runserver
BETA_MODE = os.environ.get('BETA_MODE', 'False') == 'True'

# BETA_PRICING: unabhängig von BETA_MODE. Wenn True, bleibt _read_only()
# (Trial-/Lizenz-Ablauf) für alle deaktiviert, Konto-Seite und Landingpage
# zeigen statt Preis/"Rechnung anfordern" den Beta-Hinweis ("kostenlos &
# unbeschränkt"). So bleibt die Nutzung während der Beta-Phase komplett
# kostenlos, obwohl (ab BETA_MODE=False) ein Login nötig ist.
# Default True = Beta läuft. Zusammen mit SHOW_PRICING=False (siehe unten) ist
# das der konsistente Beta-Zustand: keine Bezahlpflicht, keine Beträge nach
# aussen. Beim Beenden der Beta BEIDE Schalter zusammen drehen — BETA_PRICING
# =False bei SHOW_PRICING=False hiesse, dass Kunden zahlen müssen, während die
# Landingpage weiter "Aktuell kostenlos" verspricht.
BETA_PRICING = os.environ.get('BETA_PRICING', 'True') == 'True'

# Kostenlose Testphase ab Registrierung; danach Read-Only bis zur Zahlung
# (accounts.models.Subscription) — sofern BETA_PRICING nicht aktiv ist.
# Preis wie auf der Landingpage.
TRIAL_DAYS = 30
# Listenpreis pro Nutzer und Jahr — EINE Quelle für Landingpage (Preiskarte +
# JSON-LD), Konto-Seite und Rechnungstexte; ins Template kommt er über den
# `pricing`-Context-Processor. Pro Konto überschreibbar (Preisgarantie) und
# rabattierbar via Subscription.list_price_chf / .discount_percent — dort steht
# auch, warum der Rabatt prozentual ist.
LICENSE_PRICE_CHF = 240
# Preiskommunikation nach aussen: die Preis-Karte auf der Landingpage samt
# Preis-Erwähnungen in FAQ und JSON-LD sowie der künftige Preis auf der
# Konto-Seite während der Beta. Die Preissektion selbst ("Preismodell" mit der
# Beta-kostenlos-Info) und der "Preise"-Nav-Link bleiben immer sichtbar.
# False = Beträge ausgeblendet, solange das Pricing noch nicht entschieden/
# kommuniziert werden soll. Bewusst NICHT betroffen: die
# Jahrespreis-Zeile zahlender Kunden (deren Vertragspreis) und der Verkaufs-
# Modus nach der Beta (BETA_PRICING=False zeigt den Preis neben "Rechnung
# anfordern" immer — dann muss SHOW_PRICING ohnehin wieder True sein).
SHOW_PRICING = True
# Globale Preisaktion für ALLE (0 = aus). Die Landingpage-Karte zeigt dann den
# Listenpreis durchgestrichen, darunter den Aktionspreis und die Begründung;
# Konto-Seite und Rechnungspreis ziehen mit. Ein persönlicher Rabatt
# (Subscription.discount_percent) stapelt sich NICHT dazu — es gilt der höhere
# der beiden (accounts/pricing.py). GLOBAL_DISCOUNT_UNTIL ist optional
# ('YYYY-MM-DD'); ab dem Folgetag greift die Aktion nicht mehr, leer =
# unbefristet. Bewusst wie LICENSE_PRICE_CHF direkt hier statt per Env: so
# steht der laufende Preis im git und nicht in der systemd-Unit.
# Aktuelle Kampagne ist mengen- statt zeitbasiert ("die ersten 50 Lizenzen"):
# UNTIL bleibt deshalb leer (unbefristet) — es gibt keinen automatischen
# Cutover, die Anzahl bezahlter Lizenzen wird von Hand mitgezählt und der
# Rabatt bei Erreichen manuell auf 0 gesetzt.
# WICHTIG — das allein macht den Rabatt NICHT lifetime: effective_discount
# fragt diesen Schalter bei JEDER Rechnung live ab, auch bei Verlängerungen
# (accounts/models.py). Wird er nach der 50. Lizenz ausgeschaltet, zahlen
# auch die ersten 50 ab ihrer nächsten Verlängerung wieder den vollen Preis
# — das globale Flag merkt sich niemanden. Das Versprechen "dauerhaft für
# dich reserviert" gilt daher nur, wenn zusätzlich JEDE der ersten 50
# Rechnungen sofort bei Ausstellung/Bezahlt-Markieren einen PERSÖNLICHEN
# Rabatt auf der jeweiligen Subscription bekommt (Admin-Action "Rabatt
# setzen", 35 %, scope=lifetime) — der bleibt unabhängig von diesem Schalter
# bestehen. Nicht erst rückwirkend beim Erreichen von 50 nachtragen, sonst
# ist unklar, wer schon vor der Umstellung bezahlt hat. Details: CLAUDE.md
# unter "Trial & Lizenz (Subscription)".
GLOBAL_DISCOUNT_PERCENT = 0
GLOBAL_DISCOUNT_REASON = 'Einführungsrabatt für die ersten 50 Lizenzen. Dieser gilt dauerhaft und erlischt nicht nach einem Jahr.'
GLOBAL_DISCOUNT_UNTIL = ''

# ── Rechnungsstellung (QR-Rechnung) ──────────────────────────────────────
INVOICE_CREDITOR = {
    'name': 'Bauphysik Lengg',
    'street': 'Rathausgasse 8',
    'pcode': '5000',
    'city': 'Aarau',
    'country': 'CH',
}
INVOICE_IBAN = 'CH17 0839 0038 8046 1000 1'     # normale IBAN (keine QR-IBAN)
INVOICE_VAT_UID = 'CHE-436.392.751 MWST'        # erscheint im Rechnungskopf
INVOICE_VAT_RATE = '8.1'                        # Prozent, '' = kein MWST-Ausweis
# Ist LICENSE_PRICE_CHF brutto (inkl. MWST) oder netto? Brutto, weil die
# Landingpage den Betrag ohne "zzgl. MWST" zeigt — beim Umstellen auf False
# schreibt die Preiskarte automatisch "zzgl. MWST" dazu.
LICENSE_PRICE_INCLUDES_VAT = True
INVOICE_DUE_DAYS = 30
# Kopie jeder versendeten Rechnung an dich (leer = aus)
INVOICE_BCC = 'info@planli.net'
# Stichtage (Tage vor Lizenzablauf) für die Erinnerungs-Mails des täglichen
# renewal_reminders-Crons — siehe accounts/management/commands/
RENEWAL_REMINDER_DAYS = (30, 7)
# Abgelegte Rechnungs-PDFs. Aufbewahrungspflicht 10 Jahre (OR 958f) —
# weder vom Cleanup noch von der Kontolöschung angefasst.
INVOICES_DIR = BASE_DIR / 'invoices'
# Feedback-Dankeschön (Akquise-Phase): Wer die drei Feedback-Fragen in der App
# beantwortet, bekommt einmalig eine auf 6 Monate verlängerte Testphase
# (trial_ends = jetzt + FEEDBACK_REWARD_DAYS, siehe core.views.submit_feedback).
FEEDBACK_REWARD_DAYS = 180
# Projektlimit der Online-Ablage: Default für neue User;
# pro User im Admin überschreibbar (Subscription.max_projects, z.B. 200).
# Wird beim Anlegen der Subscription als fester Wert gespeichert — eine Änderung
# hier trifft nur neue Konten, Bestandskonten brauchen eine Datenmigration
# (siehe accounts/migrations/0009). 100 statt anfangs 50 (9.10.2026): ~50 MB bis max. 200 MB 
# pro Projekt ⇒ ~ 50 GB pro vollem Konto, Speicherkosten vernachlässigbar.
DEFAULT_MAX_PROJECTS = 100
# Online-Ablage: dauerhaft gespeicherte .planli-Projekte pro User
# (StoredProject). Wie training_data_opt-in nie vom Cleanup berührt.
CLOUD_PROJECTS_DIR = BASE_DIR / 'cloud_projects'
# Stiller technischer Deckel pro Projekt (Ausreisser-Schutz, kein beworbenes Limit)
MAX_PROJECT_MB = 200
# Grösste hochladbare PDF. EINE Quelle für Server-Prüfung und Browser-Vorabcheck
# (via window.PLANLI_MAX_UPLOAD_MB in app.html) — vorher standen hier 40 MB und
# im Frontend 100, was Dateien dazwischen erst nach dem vollen Upload abwies.
# Bewusst 10 MB unter nginx' client_max_body_size (100M): Der Multipart-Overhead
# kommt zur Dateigrösse dazu, und liegt nginx gleichauf, kappt es die Verbindung
# mit einer HTML-413, bevor Django eine verständliche Meldung schicken kann.
MAX_UPLOAD_MB = 90

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
