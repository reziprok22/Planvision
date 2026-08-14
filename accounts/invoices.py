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
from reportlab.pdfgen import canvas

from .models import Invoice

# Solange die Beispiel-IBAN aus den Settings drinsteht, wäre jeder erzeugte
# QR-Code unbezahlbar — lieber hart abbrechen als eine tote Rechnung versenden.
PLACEHOLDER_IBAN = 'CH0000000000000000000'

LICENSE_TERM_DAYS = 365


class InvoiceConfigError(RuntimeError):
    """Zahlungsdaten in den Settings fehlen oder sind noch Platzhalter."""


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
    last = Invoice.objects.filter(number__startswith=prefix).order_by('-number').first()
    seq = int(last.number.split('-')[1]) + 1 if last else 1
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


@transaction.atomic
def create_invoice(user, sub, address):
    """Rechnung für die nächste Jahreslizenz anlegen und die Lizenz sofort
    freischalten (ohne Versand).

    `address` ist das validierte Formular-Dict. Alle Beträge werden hier
    eingefroren; spätere Preis- oder Rabattänderungen berühren die Rechnung
    nicht mehr."""
    check_config()
    today = timezone.localdate()
    # Anschluss an eine laufende Lizenz, sonst ab heute
    start = sub.paid_until if (sub.paid_until and sub.paid_until > today) else today
    net, vat, total = split_amounts(sub.price_chf)
    invoice = Invoice.objects.create(
        user=user,
        number=next_number(today),
        issued_on=today,
        due_on=today + timedelta(days=settings.INVOICE_DUE_DAYS),
        net_chf=net, vat_rate=vat_rate(), vat_chf=vat, total_chf=total,
        period_start=start,
        period_end=start + timedelta(days=LICENSE_TERM_DAYS),
        list_price_chf=sub.list_price,
        discount_percent=sub.effective_discount.percent,
        discount_note=sub.discount_label,
        billing_email=user.email or user.username,
        **address,
    )
    activate_licence(sub, invoice)
    return invoice


# ── PDF ──────────────────────────────────────────────────────────────────
def _iban_display():
    """IBAN in Vierergruppen, wie auf dem Zahlteil."""
    iban = settings.INVOICE_IBAN.replace(' ', '')
    return ' '.join(iban[i:i + 4] for i in range(0, len(iban), 4))



def _qr_page(invoice):
    """A4-Seite mit dem Zahlteil in den unteren 105 mm."""
    bill = QRBill(
        account=settings.INVOICE_IBAN.replace(' ', ''),
        creditor=dict(settings.INVOICE_CREDITOR),
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


def _text_page(invoice):
    """A4-Seite mit dem Rechnungstext (obere zwei Drittel — unten liegt der
    Zahlteil)."""
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    creditor = settings.INVOICE_CREDITOR

    def line(x_mm, y_mm, text, font='Helvetica', size=9.5):
        pdf.setFont(font, size)
        pdf.drawString(x_mm * mm, height - y_mm * mm, text)

    def right(y_mm, text, font='Helvetica', size=9.5, x_mm=190):
        pdf.setFont(font, size)
        pdf.drawRightString(x_mm * mm, height - y_mm * mm, text)

    # Absender
    line(20, 22, creditor['name'], 'Helvetica-Bold', 14)
    line(20, 28, creditor['street'])
    line(20, 33, f"{creditor['pcode']} {creditor['city']}")
    if settings.INVOICE_VAT_UID:
        line(20, 38, settings.INVOICE_VAT_UID)

    # Empfänger
    for i, text in enumerate(invoice.address_lines):
        line(120, 50 + i * 5, text)

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
        line(20, y, f'inkl. {invoice.discount_note} (Basispreis CHF {invoice.list_price_chf})',
             'Helvetica', 8.5)

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
    line(20, y, 'Zahlbar mit dem QR-Zahlteil unten. Bitte die Rechnungsnummer '
                'als Mitteilung angeben.', 'Helvetica', 8.5)
    y += 5
    line(20, y, 'Das Konto ist für die oben genannte Laufzeit bereits freigeschaltet.',
         'Helvetica', 8.5)
    y += 5
    line(20, y, f'Konto: {_iban_display()}', 'Helvetica', 8.5)

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
