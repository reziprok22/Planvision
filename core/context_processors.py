from django.conf import settings


def analytics(request):
    """Stellt die Plausible-Domain allen Templates bereit (leer = Tracking aus)."""
    return {'plausible_domain': settings.PLAUSIBLE_DOMAIN}


def beta_mode(request):
    """Stellt BETA_MODE allen Templates bereit (Nav-Login-Link, Beta-Badge etc.)."""
    return {'beta_mode': settings.BETA_MODE}
