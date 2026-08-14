from django.conf import settings

from accounts.pricing import public_price, vat_note


def analytics(request):
    """Stellt die Plausible-Domain allen Templates bereit (leer = Tracking aus)."""
    return {'plausible_domain': settings.PLAUSIBLE_DOMAIN}


def beta_mode(request):
    """Stellt BETA_MODE allen Templates bereit (Nav-Login-Link etc.)."""
    return {'beta_mode': settings.BETA_MODE}


def pricing(request):
    """Preis-Kontext für alle Templates:

    - `beta_pricing`: Beta-Badge und Read-Only-/Rechnungs-Hinweise
    - `license_price_chf`: Listenpreis als EINE Quelle für Landingpage
      (Karte + JSON-LD), Konto-Seite und Rechnungstexte. Vorher stand der
      Betrag zusätzlich hartcodiert im Template.
    - `license_price_now` / `global_discount`: aktueller Aktionspreis und der
      Rabatt dahinter (Prozent, Begründung, optionales Enddatum). Ohne Aktion
      ist `global_discount` falsy und `license_price_now == license_price_chf`.
    """
    base, now, discount = public_price()
    return {
        'beta_pricing': settings.BETA_PRICING,
        'license_price_chf': base,
        'license_price_now': now,
        'global_discount': discount,
        # 'inkl./zzgl. MWST' — muss auf der Preiskarte stehen, sonst wäre der
        # Betrag je nach LICENSE_PRICE_INCLUDES_VAT irreführend.
        'price_vat_note': vat_note(),
    }
