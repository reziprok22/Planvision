"""Preisberechnung an einem Ort.

Drei Ebenen, die sich alle auf denselben Listenpreis beziehen:

1. `settings.LICENSE_PRICE_CHF` — Listenpreis pro Nutzer und Jahr
2. **globaler Aktionsrabatt** (`settings.GLOBAL_DISCOUNT_*`) — gilt für alle,
   erscheint auf der Landingpage-Karte mit durchgestrichenem Originalpreis
3. **persönlicher Rabatt** pro Konto (`Subscription.discount_*`)

Persönlicher und globaler Rabatt **stapeln nie**: es gewinnt der höhere
(`Subscription.effective_discount`). Sonst käme man mit zwei 50 %-Aktionen auf
75 % — ein Rabatt, den niemand versprochen hat.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.utils import timezone

DISCOUNT_ONCE = 'once'
DISCOUNT_LIFETIME = 'lifetime'
DISCOUNT_SCOPES = [
    (DISCOUNT_ONCE, 'Einmalig (nur die nächste Jahreslizenz)'),
    (DISCOUNT_LIFETIME, 'Dauerhaft (jede Verlängerung)'),
]


@dataclass(frozen=True)
class Discount:
    """Ein geltender Rabatt — global (mit `until`) oder persönlich (mit `scope`)."""

    percent: int
    reason: str = ''
    until: date | None = None
    scope: str = ''

    def __bool__(self):
        return self.percent > 0

    @property
    def label(self):
        """Ein Satz für Konto-Seite, Landingpage und Admin.

        Aufbau: "20 % Rabatt (Einführungsrabatt), gültig bis 31.12.2026" —
        Grund in Klammern hinter der Prozentzahl, Laufzeit als angehängter
        Teilsatz. Das Wort "Rabatt" bleibt bewusst stehen, auch wenn der Grund
        es wiederholt: der Grund ist frei getippt ("Beta-Tester",
        "Mengenrabatt 8 Lizenzen") und ergäbe sonst je nach Eingabe
        Kauderwelsch."""
        if not self:
            return ''
        text = f'{self.percent} % Rabatt'
        if self.reason:
            text += f' ({self.reason})'
        if self.scope == DISCOUNT_LIFETIME:
            text += ', dauerhaft'
        elif self.scope == DISCOUNT_ONCE:
            text += ', einmalig für die nächste Jahreslizenz'
        elif self.until:
            text += f', gültig bis {self.until.strftime("%d.%m.%Y")}'
        return text


NO_DISCOUNT = Discount(0)


def list_price():
    """Listenpreis in CHF pro Nutzer und Jahr, vor jedem Rabatt."""
    return settings.LICENSE_PRICE_CHF


def vat_note():
    """'inkl. 8.1 % MWST' bzw. 'zzgl. …' — leer, wenn kein MWST-Ausweis
    konfiguriert ist. Steht auf der Preiskarte, der Konto-Seite und im
    Rechnungsformular, damit überall dieselbe Aussage steht."""
    rate = settings.INVOICE_VAT_RATE
    if not rate:
        return ''
    if settings.LICENSE_PRICE_INCLUDES_VAT:
        return f'inkl. {rate} % MWST'
    return f'zzgl. {rate} % MWST'


def apply_discount(price, percent):
    """Rabattierter Preis, kaufmännisch auf ganze Franken gerundet
    (round() würde bei .5 zur geraden Zahl runden, also 122.5 → 122)."""
    if not percent:
        return price
    net = Decimal(price) * (100 - percent) / 100
    return int(net.to_integral_value(rounding=ROUND_HALF_UP))


def _parse_until(value):
    """'YYYY-MM-DD' → date. Unlesbares Datum heisst unbefristet: eine
    Preisaktion darf die Landingpage nie mit einem 500er abschiessen."""
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        return None


def global_discount():
    """Der aktive Aktionsrabatt für alle, sonst NO_DISCOUNT.

    Aus den Settings statt aus der DB: Preisaktionen ändern sich selten und
    gehören zum Deploy-Stand, den man im git nachlesen kann."""
    percent = max(0, min(100, getattr(settings, 'GLOBAL_DISCOUNT_PERCENT', 0) or 0))
    if not percent:
        return NO_DISCOUNT
    until = _parse_until(getattr(settings, 'GLOBAL_DISCOUNT_UNTIL', ''))
    if until and timezone.localdate() > until:
        return NO_DISCOUNT
    return Discount(percent, getattr(settings, 'GLOBAL_DISCOUNT_REASON', ''), until=until)


def public_price():
    """Was die Landingpage zeigt: (Listenpreis, aktueller Preis, Rabatt)."""
    discount = global_discount()
    base = list_price()
    return base, apply_discount(base, discount.percent), discount
