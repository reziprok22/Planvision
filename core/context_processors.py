from django.conf import settings


def analytics(request):
    """Stellt die Plausible-Domain allen Templates bereit (leer = Tracking aus)."""
    return {'plausible_domain': settings.PLAUSIBLE_DOMAIN}


def beta_mode(request):
    """Stellt BETA_MODE allen Templates bereit (Nav-Login-Link etc.)."""
    return {'beta_mode': settings.BETA_MODE}


def beta_pricing(request):
    """Stellt BETA_PRICING allen Templates bereit (Beta-Badge, Preis-/Read-Only-Hinweise)."""
    return {'beta_pricing': settings.BETA_PRICING}
