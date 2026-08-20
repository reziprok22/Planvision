"""Rechnungsstellung: Beträge, Nummernkreis, PDF mit QR-Zahlteil, Versand.

Der Zahlteil kommt von `qrbill` als SVG und wird mit **cairosvg** in eine
A4-PDF-Seite gerendert (Systempaket `libcairo2`). svglib wurde probiert und
verworfen: qrbill mischt mm-Koordinaten in einem px-viewBox, svglib verschiebt
dadurch den ganzen Zahlteil und lässt den Betrag weg — mit cairosvg sitzt er
normkonform in den unteren 105 mm. Der Rechnungstext entsteht separat mit
reportlab; beide Seiten werden per PyPDF2 übereinandergelegt.
"""

import io
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

import cairosvg
from django.conf import settings
from django.core.mail import EmailMessage
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone
from PyPDF2 import PdfReader, PdfWriter
from qrbill import QRBill
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

from .models import Invoice

# Solange die Beispiel-IBAN aus den Settings drinsteht, wäre jeder erzeugte
# QR-Code unbezahlbar — lieber hart abbrechen als eine tote Rechnung versenden.
PLACEHOLDER_IBAN = 'CH0000000000000000000'

def one_year_later(day):
    """Lizenzlaufzeit = ein Kalenderjahr, nicht 365 Tage: über ein Schaltjahr
    verlöre der Kunde sonst einen Tag. 29.2. landet auf dem 28.2."""
    try:
        return day.replace(year=day.year + 1)
    except ValueError:
        return day.replace(year=day.year + 1, day=28)


class InvoiceConfigError(RuntimeError):
    """Zahlungsdaten in den Settings fehlen oder sind noch Platzhalter."""


class OpenInvoiceError(RuntimeError):
    """Für dieses Konto ist bereits eine Rechnung offen."""


def _q(value):
    """Auf Rappen runden — kaufmännisch, nicht bankers-rounding."""
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def vat_rate():
    return Decimal(settings.INVOICE_VAT_RATE or 0)


def split_amounts(price_chf):
    """(netto, mwst, total) aus dem Jahrespreis.

    Ob `price_chf` brutto oder netto ist, sagt LICENSE_PRICE_INCLUDES_VAT —
    das Total ist bei brutto exakt der angezeigte Preis, damit Konto-Seite und
    Rechnung nie um Rappen auseinanderlaufen."""
    price = Decimal(price_chf)
    rate = vat_rate()
    if not rate:
        return _q(price), Decimal('0.00'), _q(price)
    if settings.LICENSE_PRICE_INCLUDES_VAT:
        total = _q(price)
        net = _q(price / (1 + rate / 100))
        return net, total - net, total
    net = _q(price)
    vat = _q(net * rate / 100)
    return net, vat, _q(net + vat)


def next_number(today=None):
    """Fortlaufende Nummer pro Jahr (2026-0001). Aufrufer muss in einer
    Transaktion sein — SQLite läuft hier im IMMEDIATE-Modus, das Schreiblock
    wird also schon beim BEGIN genommen und zwei gleichzeitige Anfragen
    serialisieren statt dieselbe Nummer zu ziehen."""
    today = today or timezone.localdate()
    prefix = f'{today.year}-'
    # Numerisch statt als String maximieren: '9999' > '10000' in der
    # String-Sortierung — ab 10'000 Rechnungen/Jahr zöge order_by('-number')
    # sonst eine schon vergebene Nummer.
    numbers = Invoice.objects.filter(number__startswith=prefix).values_list('number', flat=True)
    seq = max((int(n.split('-')[1]) for n in numbers), default=0) + 1
    return f'{prefix}{seq:04d}'


def check_config():
    """Vor dem Ausstellen prüfen, ob echte Zahlungsdaten hinterlegt sind."""
    iban = (settings.INVOICE_IBAN or '').replace(' ', '')
    if not iban or iban == PLACEHOLDER_IBAN:
        raise InvoiceConfigError(
            'INVOICE_IBAN ist noch der Platzhalter — bitte echte IBAN in den '
            'Settings eintragen, sonst ist der QR-Zahlteil nicht bezahlbar.')


def activate_licence(sub, invoice):
    """Lizenz sofort auf die Laufzeit der Rechnung freischalten.

    Bewusst **bei der Rechnungsstellung**, nicht erst bei Zahlungseingang: der
    Kunde soll nicht tagelang auf den Zahlungsabgleich warten. Der
    Zahlungseingang bestätigt die Rechnung nur noch (Admin-Action). Kehrseite:
    eine nie bezahlte Rechnung hat ein Jahr freigeschaltet — dafür gibt es im
    Admin "Stornieren", das die Freischaltung zurücknimmt.

    Hier fällt auch alles an, was an die Lizenzvergabe gekoppelt ist: ein
    einmaliger Rabatt gilt als eingelöst (er steckt in dieser Rechnung) und der
    Basispreis wird festgeschrieben (Preisgarantie)."""
    sub.paid_until = invoice.period_end
    fields = ['paid_until']
    if sub.consume_discount():
        fields.append('discount_used_at')
    if sub.pin_list_price():
        fields.append('list_price_chf')
    sub.save(update_fields=fields)


def backfill_licence(sub, invoice):
    """Laufzeit einer Rechnung nachtragen — ohne die Nebenwirkungen von
    `activate_licence()`.

    Gedacht für den Reparaturpfad im Admin ("Als bezahlt markieren" bei einer
    Altrechnung oder einem von Hand geleerten `paid_until`). Dort darf **nur**
    `paid_until` gesetzt werden: Rabatt-Verbrauch und Preisfixierung gehören
    zur Ausstellung dieser Rechnung und sind damals passiert (oder eben nicht).
    Sonst frisst das nachträgliche Verbuchen einer alten Rechnung einen
    inzwischen neu vergebenen Einmal-Rabatt und schreibt den heutigen
    Listenpreis fest. Speichert selbst; gibt zurück, ob sich etwas geändert
    hat."""
    if sub.paid_until is not None and sub.paid_until >= invoice.period_end:
        return False
    sub.paid_until = invoice.period_end
    sub.save(update_fields=['paid_until'])
    return True


@transaction.atomic
def create_invoice(user, sub, address):
    """Rechnung für die nächste Jahreslizenz anlegen und die Lizenz sofort
    freischalten (ohne Versand).

    `address` ist das validierte Formular-Dict. Alle Beträge werden hier
    eingefroren; spätere Preis- oder Rabattänderungen berühren die Rechnung
    nicht mehr."""
    check_config()
    # Höchstens eine offene Rechnung pro Konto — hier drin statt nur im View,
    # weil die Transaktion (IMMEDIATE) gleichzeitige Anfragen serialisiert:
    # ein Doppelklick auf "Rechnung erstellen" passiert den View-Check zweimal,
    # aber nur der erste kommt hier durch.
    if user.invoices.filter(status=Invoice.STATUS_OPEN).exists():
        raise OpenInvoiceError(f'Offene Rechnung für {user.username} existiert bereits.')
    today = timezone.localdate()
    # Anschluss an eine laufende Lizenz ODER die restliche Testphase, sonst ab
    # heute. Trial-Resttage anzurechnen ist fair (wer früh kauft, verliert
    # nichts) — das gilt auch für per Feedback-Dankeschön verlängerte Trials.
    anchors = [today]
    if sub.paid_until:
        anchors.append(sub.paid_until)
    if sub.trial_ends:
        anchors.append(timezone.localtime(sub.trial_ends).date())
    start = max(anchors)
    net, vat, total = split_amounts(sub.price_chf)
    invoice = Invoice.objects.create(
        user=user,
        number=next_number(today),
        issued_on=today,
        due_on=today + timedelta(days=settings.INVOICE_DUE_DAYS),
        net_chf=net, vat_rate=vat_rate(), vat_chf=vat, total_chf=total,
        period_start=start,
        period_end=one_year_later(start),
        # Vorzustand einfrieren, damit der Storno ihn zurückschreiben kann,
        # statt ihn aus period_start zu erraten (siehe Modell-Kommentar).
        previous_paid_until=sub.paid_until,
        list_price_chf=sub.list_price,
        discount_percent=sub.effective_discount.percent,
        # invoice_label statt label: ohne "gültig bis"-/Laufzeit-Zusätze,
        # die auf einem eingefrorenen Beleg widersinnig wären
        discount_note=sub.effective_discount.invoice_label,
        billing_email=user.email or user.username,
        # Zahlungsempfänger einfrieren (siehe Modell-Kommentar)
        creditor_iban=(settings.INVOICE_IBAN or '').replace(' ', ''),
        creditor=dict(settings.INVOICE_CREDITOR),
        creditor_vat_uid=settings.INVOICE_VAT_UID or '',
        **address,
    )
    activate_licence(sub, invoice)
    return invoice


# ── PDF ──────────────────────────────────────────────────────────────────
# Die Empfänger-Daten kommen aus den eingefrorenen Invoice-Feldern, nicht aus
# den Settings: eine Regeneration (Datei verloren) muss denselben Beleg
# ergeben wie der Erstversand — auch nach einem Bankwechsel. Fallback auf die
# Settings nur für Rechnungen aus der Zeit vor den creditor_*-Feldern.
def _frozen_iban(invoice):
    return invoice.creditor_iban or (settings.INVOICE_IBAN or '').replace(' ', '')


def _frozen_creditor(invoice):
    return invoice.creditor or dict(settings.INVOICE_CREDITOR)


def _frozen_vat_uid(invoice):
    # creditor_iban als Marker für "hat eingefrorene Daten": eine leere UID
    # auf einer neuen Rechnung heisst "keine UID", nicht "Settings fragen".
    return invoice.creditor_vat_uid if invoice.creditor_iban else settings.INVOICE_VAT_UID


def _iban_display(invoice):
    """IBAN in Vierergruppen, wie auf dem Zahlteil."""
    iban = _frozen_iban(invoice)
    return ' '.join(iban[i:i + 4] for i in range(0, len(iban), 4))


def _qr_page(invoice):
    """A4-Seite mit dem Zahlteil in den unteren 105 mm."""
    bill = QRBill(
        account=_frozen_iban(invoice),
        creditor=_frozen_creditor(invoice),
        debtor={
            'name': invoice.billing_company or invoice.billing_name,
            'street': invoice.billing_street,
            'pcode': invoice.billing_zip,
            'city': invoice.billing_city,
            'country': invoice.billing_country,
        },
        amount=f'{invoice.total_chf:.2f}',
        currency='CHF',
        # Keine strukturierte Referenz (normale IBAN): die Rechnungsnummer
        # geht als Mitteilung mit und ist so im Bankauszug sichtbar.
        additional_information=f'Rechnung {invoice.number}',
        language='de',
    )
    buf = io.StringIO()
    bill.as_svg(buf, full_page=True)
    return cairosvg.svg2pdf(bytestring=buf.getvalue().encode('utf-8'))


def _cancelled_stamp(pdf, width, height):
    """Diagonaler "STORNIERT"-Stempel über die ganze Seite.

    Halbtransparent, damit der Rechnungstext darunter lesbar bleibt — der
    Beleg soll entwertet, nicht unleserlich sein."""
    pdf.saveState()
    pdf.translate(width / 2, height / 2)
    pdf.rotate(35)
    pdf.setFont('Helvetica-Bold', 72)
    pdf.setFillColorRGB(0.8, 0.1, 0.1)
    pdf.setFillAlpha(0.28)
    pdf.drawCentredString(0, 0, 'STORNIERT')
    pdf.restoreState()


def _text_page(invoice):
    """A4-Seite mit dem Rechnungstext (obere zwei Drittel — unten liegt der
    Zahlteil)."""
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    creditor = _frozen_creditor(invoice)

    def line(x_mm, y_mm, text, font='Helvetica', size=9.5):
        pdf.setFont(font, size)
        pdf.drawString(x_mm * mm, height - y_mm * mm, text)

    def right(y_mm, text, font='Helvetica', size=9.5, x_mm=190):
        pdf.setFont(font, size)
        pdf.drawRightString(x_mm * mm, height - y_mm * mm, text)

    def wrap(x_mm, y_mm, text, max_w_mm, font='Helvetica', size=9.5):
        """Wie line(), aber mit Zeilenumbruch bei max_w_mm — Adresszeilen
        dürfen laut QR-Norm 70 Zeichen lang sein und liefen sonst über den
        rechten Rand hinaus. Gibt die nächste freie y-Position zurück."""
        pdf.setFont(font, size)
        for chunk in simpleSplit(text, font, size, max_w_mm * mm):
            pdf.drawString(x_mm * mm, height - y_mm * mm, chunk)
            y_mm += 5
        return y_mm

    # Absender
    line(20, 22, creditor['name'], 'Helvetica-Bold', 14)
    line(20, 28, creditor['street'])
    line(20, 33, f"{creditor['pcode']} {creditor['city']}")
    if _frozen_vat_uid(invoice):
        line(20, 38, _frozen_vat_uid(invoice))

    # Empfänger (120–190 mm; lange Zeilen umbrechen)
    y_addr = 50
    for text in invoice.address_lines:
        y_addr = wrap(120, y_addr, text, max_w_mm=70)

    # Kopf
    line(20, 80, f'Rechnung {invoice.number}', 'Helvetica-Bold', 13)
    line(20, 88, f'Rechnungsdatum: {invoice.issued_on:%d.%m.%Y}')
    line(20, 93, f'Zahlbar bis: {invoice.due_on:%d.%m.%Y}')

    # Positionen
    y = 108
    pdf.line(20 * mm, height - (y - 4) * mm, 190 * mm, height - (y - 4) * mm)
    line(20, y, 'Position', 'Helvetica-Bold')
    right(y, 'Betrag CHF', 'Helvetica-Bold')
    y += 8
    line(20, y, 'Planli Jahreslizenz, 1 Nutzer')
    right(y, f'{invoice.net_chf:.2f}')
    y += 5
    line(20, y, f'Laufzeit {invoice.period_start:%d.%m.%Y} – {invoice.period_end:%d.%m.%Y}',
         'Helvetica', 8.5)
    if invoice.discount_percent:
        y += 5
        # Rabatt-Grund ist Freitext und kann lang sein — ebenfalls umbrechen
        y = wrap(20, y, f'inkl. {invoice.discount_note} (Basispreis CHF {invoice.list_price_chf})',
                 max_w_mm=150, font='Helvetica', size=8.5) - 5

    y += 8
    pdf.line(20 * mm, height - (y - 4) * mm, 190 * mm, height - (y - 4) * mm)
    if invoice.vat_rate:
        line(20, y, 'Nettobetrag')
        right(y, f'{invoice.net_chf:.2f}')
        y += 5
        line(20, y, f'MWST {invoice.vat_rate:.1f} %')
        right(y, f'{invoice.vat_chf:.2f}')
        y += 6
    line(20, y, 'Gesamtbetrag', 'Helvetica-Bold', 10.5)
    right(y, f'{invoice.total_chf:.2f}', 'Helvetica-Bold', 10.5)

    # Hinweise
    y += 14
    if invoice.status == Invoice.STATUS_CANCELLED:
        # Eine stornierte Rechnung darf nicht mehr zum Zahlen auffordern: der
        # QR-Zahlteil bleibt zwar auf der Seite (er kommt aus der unteren
        # Ebene), Text und Stempel müssen ihn aber entwerten — sonst zahlt
        # jemand eine gegenstandslose Rechnung ein.
        line(20, y, 'Diese Rechnung wurde storniert. Bitte nicht bezahlen, der '
                    'Zahlteil unten ist ungültig.', 'Helvetica-Bold', 8.5)
        y += 5
        line(20, y, 'Die damit ausgestellte Freischaltung wurde zurückgenommen.',
             'Helvetica', 8.5)
    else:
        line(20, y, 'Zahlbar mit dem QR-Zahlteil unten. Bitte die Rechnungsnummer '
                    'als Mitteilung angeben.', 'Helvetica', 8.5)
        y += 5
        line(20, y, 'Das Konto ist für die oben genannte Laufzeit bereits freigeschaltet.',
             'Helvetica', 8.5)
        y += 5
        line(20, y, f'Konto: {_iban_display(invoice)}', 'Helvetica', 8.5)

    if invoice.status == Invoice.STATUS_CANCELLED:
        _cancelled_stamp(pdf, width, height)

    pdf.showPage()
    pdf.save()
    return buf.getvalue()


def render_pdf(invoice):
    """Rechnungstext und Zahlteil auf eine A4-Seite legen.

    Reihenfolge zwingend so herum: die qrbill-SVG beginnt mit einem
    deckenden weissen Rechteck über die ganze Seite — läge sie oben, wäre der
    Rechnungstext unsichtbar."""
    page = PdfReader(io.BytesIO(_qr_page(invoice))).pages[0]
    page.merge_page(PdfReader(io.BytesIO(_text_page(invoice))).pages[0])
    writer = PdfWriter()
    writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def store_pdf(invoice):
    """PDF erzeugen und ablegen (Aufbewahrungspflicht). Gibt den Pfad zurück."""
    settings.INVOICES_DIR.mkdir(parents=True, exist_ok=True)
    path = invoice.pdf_path
    path.write_bytes(render_pdf(invoice))
    return path


def send_invoice(invoice):
    """Rechnung als PDF-Anhang an den Kunden, Kopie an INVOICE_BCC."""
    if not invoice.pdf_path.exists():
        store_pdf(invoice)
    pdf = invoice.pdf_path.read_bytes()
    context = {'invoice': invoice}
    subject = render_to_string('accounts/rechnung_subject.txt', context).strip()
    body = render_to_string('accounts/rechnung_email.txt', context)
    mail = EmailMessage(subject, body, to=[invoice.billing_email])
    if settings.INVOICE_BCC:
        mail.bcc = [settings.INVOICE_BCC]
    mail.attach(f'{invoice.number}.pdf', pdf, 'application/pdf')
    mail.send()
