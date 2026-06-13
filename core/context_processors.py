from django.conf import settings


def analytics(request):
    """Stellt die Plausible-Domain allen Templates bereit (leer = Tracking aus)."""
    return {'plausible_domain': settings.PLAUSIBLE_DOMAIN}
