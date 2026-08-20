import logging

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404, render, redirect
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode

from .emails import send_verification_email
from .forms import BillingAddressForm, EmailUserCreationForm
from .invoices import (InvoiceConfigError, OpenInvoiceError, create_invoice,
                       send_invoice, store_pdf)
from .models import Invoice, subscription_for
from .tokens import email_verification_token

logger = logging.getLogger(__name__)


def register(request):
    if request.user.is_authenticated:
        return redirect('app')
    if request.method == 'POST':
        form = EmailUserCreationForm(request.POST)
        if form.is_valid():
            user = form.save(commit=False)
            user.is_active = False  # erst nach Klick auf den Bestätigungslink
            user.save()
            subscription_for(user)  # Trial startet mit der Registrierung
            send_verification_email(request, user)
            return redirect('verify_email_sent')
    else:
        form = EmailUserCreationForm()
    return render(request, 'accounts/register.html', {'form': form})


def verify_email_sent(request):
    return render(request, 'accounts/verify_email_sent.html')


def verify_email(request, uidb64, token):
    """Bewusst ohne Auto-Login: der Mail-Link wäre sonst ein Session-Ticket
    für jeden, der ihn abgreift (weitergeleitete Mail, geteiltes Postfach)."""
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uidb64)))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    if user is not None and email_verification_token.check_token(user, token):
        user.is_active = True
        user.save()
        # Zeitpunkt der Bestätigung festhalten (getrennt von is_active, das ein
        # Admin auch manuell setzt). Nur beim ersten Mal — der Token ist
        # Single-Use, daher läuft dieser Zweig pro Konto genau einmal.
        sub = subscription_for(user)
        if sub.email_verified_at is None:
            sub.email_verified_at = timezone.now()
            sub.save(update_fields=['email_verified_at'])
        return render(request, 'accounts/verify_email_done.html')

    # Token verbraucht, Konto aber schon aktiv: Mail-Scanner (z.B. Outlook
    # SafeLinks) rufen Links vorab per GET auf und konsumieren den Token,
    # bevor der User klickt. Dann nicht "ungültig" zeigen, sondern zum
    # Login führen.
    if user is not None and user.is_active:
        return render(request, 'accounts/verify_email_done.html')

    return render(request, 'accounts/verify_email_invalid.html')


@login_required
def rechnung_anfordern(request):
    """Self-Service: Adresse bestätigen → Rechnung erzeugen, ablegen, mailen.

    Bewusst **ohne** Read-Only-Sperre: wer bezahlen will, muss das auch nach
    Ablauf der Testphase können — das ist ja der Normalfall. Aus demselben
    Grund gibt es hier auch keinen Gate auf `sub.can_request_invoice`: die
    Konto-Seite graut den Knopf vor dem Verlängerungsfenster nur aus, wer die
    URL direkt aufruft, will bewusst früher zahlen (die Laufzeit schliesst dann
    an `paid_until` an, geht also nicht verloren)."""
    sub = subscription_for(request.user)
    if settings.BETA_PRICING:
        # In der Beta zahlt niemand etwas; die Konto-Seite zeigt den Button
        # gar nicht erst an.
        return redirect('konto')

    # Höchstens eine offene Rechnung — sonst erzeugt hektisches Klicken
    # mehrere Rechnungsnummern für dieselbe Lizenz.
    offen = request.user.invoices.filter(status=Invoice.STATUS_OPEN).first()
    if offen:
        return render(request, 'accounts/rechnung_offen.html', {'invoice': offen})

    form = BillingAddressForm(request.POST or None, instance=sub)
    error = None
    if request.method == 'POST' and form.is_valid():
        form.save()  # Adresse für das nächste Mal merken
        try:
            # Eine Transaktion um Anlegen UND PDF: schlägt das Rendern fehl,
            # rollt alles zurück (Freischaltung, Rabatt-Verbrauch, Nummer) —
            # sonst bliebe eine Rechnung übrig, deren PDF-Download für immer
            # mit demselben Fehler stirbt.
            with transaction.atomic():
                invoice = create_invoice(request.user, sub, form.address_snapshot())
                store_pdf(invoice)
        except InvoiceConfigError:
            logger.exception('Rechnung nicht erstellt: Zahlungsdaten unvollständig')
            error = ('Die Rechnungsstellung ist gerade nicht verfügbar. Wir haben '
                     'eine Meldung erhalten und kümmern uns darum.')
        except OpenInvoiceError:
            # Doppelklick/zweiter Tab: der Check oben lief noch ohne die
            # Rechnung des parallelen Requests — jetzt existiert sie.
            offen = request.user.invoices.filter(status=Invoice.STATUS_OPEN).first()
            return render(request, 'accounts/rechnung_offen.html', {'invoice': offen})
        except Exception:
            # Unerwarteter Fehler (z.B. beim PDF-Rendern): dank Rollback ist
            # keine Rechnung entstanden — dem Kunden eine verständliche
            # Meldung zeigen statt einer 500er-Seite.
            logger.exception('Rechnung nicht erstellt: Fehler beim Erzeugen')
            # activate_licence() hat `sub` im Speicher schon mutiert — nach dem
            # Rollback den DB-Stand zurückholen, sonst zeigt das Formular
            # falsche Preis-/Rabattwerte.
            sub.refresh_from_db()
            error = ('Die Rechnung konnte nicht erstellt werden. Wir haben eine '
                     'Meldung erhalten und kümmern uns darum.')
        else:
            try:
                send_invoice(invoice)
            except Exception:
                # Rechnung existiert und ist auf der Konto-Seite abrufbar —
                # eine gescheiterte Mail darf sie nicht wertlos machen.
                logger.exception('Rechnungs-Mail fehlgeschlagen (%s)', invoice.number)
            return redirect(f"{reverse('konto')}?rechnung={invoice.number}")

    return render(request, 'accounts/rechnung_form.html', {
        'form': form, 'sub': sub, 'error': error,
        'due_days': settings.INVOICE_DUE_DAYS,
    })


@login_required
def rechnung_pdf(request, number):
    """Rechnungs-PDF herunterladen (nur die eigenen)."""
    invoice = get_object_or_404(Invoice, number=number, user=request.user)
    if not invoice.pdf_path.exists():
        store_pdf(invoice)
    return FileResponse(invoice.pdf_path.open('rb'), content_type='application/pdf',
                        filename=f'Planli-Rechnung-{invoice.number}.pdf')


@login_required
def konto(request):
    return render(request, 'accounts/konto.html', {
        # Preise kommen aus der Subscription (sub.list_price / sub.price_chf /
        # sub.discount_label), nicht aus den Settings — nur so zeigen Konto-Seite
        # und Rechnung denselben Betrag, wenn für dieses Konto ein Basispreis
        # oder ein Rabatt hinterlegt ist.
        'sub': subscription_for(request.user),
        'invoices': request.user.invoices.all(),
        # Offene Rechnung: die Verlängerungs-Karte zeigt dann deren Status
        # statt eines CTAs, der ohnehin nur auf "bereits ausgestellt" liefe.
        'open_invoice': request.user.invoices.filter(
            status=Invoice.STATUS_OPEN).first(),
        # Nach dem Erstellen: Nummer aus der Redirect-URL für die Erfolgsmeldung
        'neue_rechnung': request.GET.get('rechnung', ''),
        # App-Shell-Chrome (base.html): linke Spalte statt Marketing-Nav —
        # siehe templates/_app_sidebar.html.
        'app_shell': True,
        'active_nav': 'konto',
    })


def _send_deletion_email(email):
    subject = render_to_string('accounts/konto_geloescht_subject.txt').strip()
    text_body = render_to_string('accounts/konto_geloescht_email.txt')
    html_body = render_to_string('accounts/konto_geloescht_email.html')
    message = EmailMultiAlternatives(subject, text_body, to=[email])
    message.attach_alternative(html_body, 'text/html')
    message.send()


@login_required
def konto_loeschen(request):
    """Selbstlöschung des Kontos: Passwort-Bestätigung, dann sofortige harte
    Löschung (DSGVO Art. 17 / revDSG) inkl. aller Dateien, danach
    Bestätigungs-Mail an die bisherige Adresse."""
    user = request.user
    error = None

    # Admin-Konten nicht über die Web-UI löschbar (Schutz vor Aussperrung
    # und vor Missbrauch einer offenen Admin-Session).
    if user.is_superuser or user.is_staff:
        error = 'Admin-Konten können nicht über diese Seite gelöscht werden.'
    elif request.method == 'POST':
        if user.check_password(request.POST.get('password', '')):
            email = user.email
            # Ein einziger Aufruf räumt alles ab: die DB-Zeilen per CASCADE,
            # die Dateien (cloud_projects/, projects/<uuid>/) über die
            # post_delete-Signale in core/models.py. Die liegen dort statt
            # hier, damit auch eine Löschung im /vitruv/-Admin aufräumt.
            #
            # Bewusst NICHT mitgelöscht: Rechnungen (Invoice + PDF unter
            # INVOICES_DIR) wegen der 10-jährigen Aufbewahrungspflicht
            # (OR 958f) — der User-FK ist SET_NULL, die Adresskopie steckt auf
            # der Rechnung selbst, der Beleg bleibt also vollständig und
            # verliert nur die Verknüpfung zum Konto. Ebenso bleiben
            # Trainingsdaten (training_data_opt-in/): laut
            # Datenschutzerklärung sind freigegebene Exporte bereits
            # anonymisiert und nicht ans Konto gekoppelt gespeichert, der
            # CASCADE-Delete der Project-Zeile kappt die letzte Verknüpfung.
            user.delete()
            logout(request)
            try:
                _send_deletion_email(email)
            except Exception:
                # Konto ist weg — eine fehlgeschlagene Mail soll das nicht
                # als Fehler erscheinen lassen.
                logger.exception('Bestätigungs-Mail nach Kontolöschung fehlgeschlagen')
            return render(request, 'accounts/konto_geloescht.html')
        error = 'Das Passwort ist nicht korrekt.'

    return render(request, 'accounts/konto_loeschen.html', {
        'error': error,
        'cloud_project_count': user.stored_projects.count(),
        'sub': subscription_for(user),
    })
