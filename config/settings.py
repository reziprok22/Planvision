from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-tr22ozcv4ug2_m9w263&zik-6w*s#g3&lll4iv##dds$rms685')

DEBUG = os.environ.get('DJANGO_DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

# Hinter nginx: HTTPS anhand des X-Forwarded-Proto-Headers erkennen
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Erlaubte Origins für CSRF-geschützte POSTs (Upload, Analyse, Bug-Report)
CSRF_TRUSTED_ORIGINS = os.environ.get(
    'DJANGO_CSRF_TRUSTED_ORIGINS',
    'https://onlyplans.tools,https://www.onlyplans.tools'
).split(',')


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
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

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

# BETA_MODE: zentraler Schalter für die Beta-Phase. Wenn True, löst er aus:
#   - Kein Login nötig: alle Endpunkte (App, Upload, Analyse, Bug-Reports)
#     funktionieren ohne Anmeldung.
#   - Projekte werden anonym gespeichert (user=NULL); Zugriff nur per
#     unerratbarer Session-UUID statt per Ownership-Prüfung.
#   - In der App erscheint das "Beta"-Badge, auf der Landingpage der Beta-Banner.
# Für den Produktivbetrieb mit Accounts: auf False setzen (beendet die Beta-Phase).
BETA_MODE = True

LOGIN_URL = '/accounts/login/'
LOGIN_REDIRECT_URL = '/app/'
LOGOUT_REDIRECT_URL = '/accounts/login/'

# Plausible-Analytics: Domain wie im Plausible-Dashboard angelegt (z. B. 'onlyplans.tools').
# Leer = deaktiviert; sobald gesetzt, wird das Tracking-Snippet auf allen Seiten geladen.
PLAUSIBLE_DOMAIN = ''

PDF_DPI = 150
JPEG_QUALITY = 70
