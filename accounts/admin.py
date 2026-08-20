import logging

from django import forms
from django.contrib import admin
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.shortcuts import render
from django.utils import timezone

from .invoices import backfill_licence, store_pdf
from .models import (DISCOUNT_ONCE, DISCOUNT_SCOPES, Invoice, Subscription,
                     subscription_for)

logger = logging.getLogger(__name__)


class SetDiscountForm(forms.Form):
    """Zwischenschritt der Bulk-Action: ein Rabatt für mehrere Konten."""

    discount_percent = forms.IntegerField(
        min_value=0, max_value=100, label='Rabatt (%)',
        help_text='0 setzt den Rabatt zurück.')
    discount_scope = forms.ChoiceField(choices=DISCOUNT_SCOPES, label='Laufzeit')
    discount_reason = forms.CharField(
        max_length=100, required=False, label='Grund (intern)',
        help_text='z.B. "Beta-Tester".')


class EmailVerifiedFilter(admin.SimpleListFilter):
    title = 'E-Mail bestätigt'
    parameter_name = 'email_verified'

    def lookups(self, request, model_admin):
        return (('yes', 'Ja'), ('no', 'Nein'))

    def queryset(self, request, queryset):
        if self.value() == 'yes':
            return queryset.filter(email_verified_at__isnull=False)
        if self.value() == 'no':
            return queryset.filter(email_verified_at__isnull=True)
        return queryset


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'status_label', 'email_verified', 'email_verified_at',
                    'trial_ends', 'paid_until', 'price_display', 'price_pinned',
                    'max_projects', 'discount_percent', 'discount_scope', 'created_at')
    # Nur das Projektlimit ist in der Liste editierbar. Der Rabatt steht hier
    # zwar (Übersicht), wird aber bewusst über die Action "Rabatt setzen"
    # vergeben: `discount_reason` passt nicht in die Liste, landet über
    # `Discount.invoice_label` aber eingefroren auf dem Rechnungs-PDF — inline
    # entstünde "50 % Rabatt" ohne Begründung auf dem Beleg. Die Action fragt
    # Prozent, Laufzeit und Grund zusammen ab.
    list_editable = ('max_projects',)
    list_filter = (EmailVerifiedFilter, 'discount_scope')
    search_fields = ('user__username',)
    # Bewusst keine "Verlängern"-Action mehr: Lizenzvergabe läuft ausschliesslich
    # über Rechnungen (Ausstellen schaltet frei, Invoice-Action "Als bezahlt
    # markieren" bestätigt). Eine zweite Verlängerung hier würde ein Jahr
    # doppelt gutschreiben und den Storno-Anker (paid_until == period_end)
    # zerstören.
    actions = ('set_discount',)

    def save_model(self, request, obj, form, change):
        """Ein im Änderungsformular neu gesetzter Rabatt gilt wieder als offen.

        Ohne das bewirkte ein neuer Prozentwert bei einem Konto mit bereits
        eingelöstem Einmal-Rabatt schlicht nichts: `personal_discount` bleibt
        wegen `discount_used_at` leer. Nur die Action "Rabatt setzen" hat das
        früher zurückgesetzt. Wer `discount_used_at` im selben Schritt selbst
        anfasst, behält die Kontrolle."""
        if (change and 'discount_used_at' not in form.changed_data
                and {'discount_percent', 'discount_scope'} & set(form.changed_data)):
            obj.discount_used_at = None
        super().save_model(request, obj, form, change)

    @admin.display(description='Status')
    def status_label(self, obj):
        return obj.status_label

    @admin.display(description='E-Mail bestätigt', boolean=True)
    def email_verified(self, obj):
        return obj.email_verified_at is not None

    @admin.display(description='Preis/Jahr')
    def price_display(self, obj):
        if obj.price_chf == obj.list_price:
            return f'CHF {obj.list_price}'
        return f'CHF {obj.price_chf} (statt {obj.list_price})'

    @admin.display(description='Preis fix', boolean=True)
    def price_pinned(self, obj):
        """Basispreis festgeschrieben — eine Erhöhung von LICENSE_PRICE_CHF
        geht an diesem Konto vorbei."""
        return obj.price_is_pinned

    @admin.action(description='Rabatt setzen')
    def set_discount(self, request, queryset):
        """Zweistufig: erst Formular zeigen, dann anwenden. Ein neu gesetzter
        Rabatt gilt wieder als offen (discount_used_at zurück auf leer)."""
        if 'apply' in request.POST:
            form = SetDiscountForm(request.POST)
            if form.is_valid():
                count = queryset.update(
                    discount_percent=form.cleaned_data['discount_percent'],
                    discount_scope=form.cleaned_data['discount_scope'],
                    discount_reason=form.cleaned_data['discount_reason'],
                    discount_used_at=None)
                self.message_user(request, f'Rabatt für {count} Konto/Konten gesetzt.')
                return None
        else:
            form = SetDiscountForm()
        return render(request, 'admin/accounts/set_discount.html', {
            'title': 'Rabatt setzen',
            'form': form,
            'subscriptions': queryset,
            'action_checkbox_name': ACTION_CHECKBOX_NAME,
            'selected': queryset.values_list('pk', flat=True),
            'opts': self.model._meta,
        })


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    """Rechnungen sind Buchhaltungsbelege: alle Felder read-only, geändert wird
    nur der Status über die Actions. Löschen ist deaktiviert (Aufbewahrungs-
    pflicht 10 Jahre, OR 958f) — falsch ausgestellt heisst stornieren."""

    list_display = ('number', 'issued_on', 'billing_display', 'total_chf',
                    'status', 'due_on', 'overdue', 'paid_at')
    list_filter = ('status', 'issued_on')
    search_fields = ('number', 'billing_name', 'billing_company', 'billing_email',
                     'user__username')
    date_hierarchy = 'issued_on'
    actions = ('mark_paid', 'reopen', 'cancel_invoices')

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]

    def has_add_permission(self, request):
        return False  # Rechnungen entstehen nur über den Self-Service

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description='Kunde')
    def billing_display(self, obj):
        return obj.billing_company or obj.billing_name

    @admin.display(description='Überfällig', boolean=True)
    def overdue(self, obj):
        """Offen und Frist abgelaufen. Wichtiger als früher: freigeschaltet
        wird schon beim Ausstellen, offene Rechnungen laufen also mit."""
        return obj.is_overdue

    @admin.action(description='Als bezahlt markieren (Zahlungseingang)')
    def mark_paid(self, request, queryset):
        """Nur noch Bestätigung: Freigeschaltet wurde die Lizenz bereits beim
        Ausstellen (`activate_licence`). Die Absicherung unten greift für
        Rechnungen aus der Zeit davor und für von Hand zurückgesetzte Konten —
        sie verlängert nie über die Rechnungslaufzeit hinaus, doppeltes
        Anklicken kann also keine zwei Jahre gutschreiben.

        Bewusst `backfill_licence()` statt `activate_licence()`: Letzteres
        verbraucht auch den aktuellen Einmal-Rabatt und schreibt den heutigen
        Listenpreis fest. Beides gehört zur Ausstellung dieser Rechnung und
        hätte hier Nebenwirkungen — z.B. wäre nach "storniert, Rabatt für die
        Ersatzrechnung neu vergeben, alte Rechnung versehentlich als bezahlt
        markiert" der neue Rabatt verbraucht."""
        done = skipped = repaired = 0
        for invoice in queryset:
            if invoice.status != Invoice.STATUS_OPEN:
                skipped += 1
                continue
            invoice.status = Invoice.STATUS_PAID
            invoice.paid_at = timezone.now()
            invoice.save(update_fields=['status', 'paid_at'])
            if invoice.user_id and backfill_licence(subscription_for(invoice.user), invoice):
                repaired += 1
            done += 1
        msg = f'{done} Rechnung(en) als bezahlt verbucht.'
        if repaired:
            msg += f' {repaired}× Lizenz nachgetragen.'
        if skipped:
            msg += f' {skipped} übersprungen (nicht offen).'
        self.message_user(request, msg)

    @admin.action(description='Zurück auf offen (irrtümlich als bezahlt markiert)')
    def reopen(self, request, queryset):
        """Notausgang für den Fehlklick auf "Als bezahlt markieren": setzt nur
        `status`/`paid_at` zurück. Die Lizenz bleibt unberührt — das Bezahlt-
        Markieren hat sie höchstens nachgetragen, nie verlängert; danach steht
        die Rechnung wieder als offen (ggf. überfällig) in der Liste."""
        count = queryset.filter(status=Invoice.STATUS_PAID).update(
            status=Invoice.STATUS_OPEN, paid_at=None)
        skipped = queryset.count() - count
        msg = f'{count} Rechnung(en) wieder als offen markiert.'
        if skipped:
            msg += f' {skipped} übersprungen (nicht bezahlt).'
        self.message_user(request, msg)

    @admin.action(description='Stornieren (nimmt die Freischaltung zurück)')
    def cancel_invoices(self, request, queryset):
        """Gegenstück zum Ausstellen: Wer nicht zahlt, verliert die Lizenz
        wieder. Zurückgesetzt wird nur, wenn `paid_until` noch genau auf dieser
        Rechnung steht — hat eine spätere Rechnung schon weiter verlängert,
        bleibt die neuere Laufzeit stehen. Zurückgeschrieben wird der beim
        Ausstellen eingefrorene `previous_paid_until`. Ein verbrauchter
        Einmal-Rabatt bleibt eingelöst; bei Bedarf im Subscription-Admin per
        "Rabatt setzen" neu vergeben."""
        cancelled = revoked = 0
        discount_hints = []
        pdf_failed = []
        for invoice in queryset.filter(status=Invoice.STATUS_OPEN):
            invoice.status = Invoice.STATUS_CANCELLED
            invoice.save(update_fields=['status'])
            cancelled += 1
            # PDF neu erzeugen: das abgelegte trägt noch den Zahlungsaufruf und
            # "Konto ist bereits freigeschaltet" — der Kunde kann es weiterhin
            # von der Konto-Seite laden und würde sonst eine gegenstandslose
            # Rechnung einzahlen. Das neue trägt den STORNIERT-Stempel.
            try:
                store_pdf(invoice)
            except Exception:
                logger.exception('Storno-PDF nicht erzeugt (%s)', invoice.number)
                pdf_failed.append(invoice.number)
            if invoice.user_id:
                sub = subscription_for(invoice.user)
                if sub.paid_until == invoice.period_end:
                    # Zurück auf den Stand davor — nicht aus `period_start`
                    # erraten: der Anker kann auch das Trial-Ende sein, und
                    # dann bliebe eine Lizenz stehen, die es nie gab.
                    sub.paid_until = invoice.previous_paid_until
                    sub.save(update_fields=['paid_until'])
                    revoked += 1
                # Storno + Neuausstellung ist der offizielle Korrekturweg
                # (z.B. falsche Adresse) — dabei bliebe ein mit dieser
                # Rechnung eingelöster Einmal-Rabatt verbraucht und die neue
                # Rechnung würde teurer. Daran erinnern statt es dem
                # Gedächtnis zu überlassen.
                if (invoice.discount_percent and sub.discount_percent
                        and sub.discount_scope == DISCOUNT_ONCE
                        and sub.discount_used_at is not None):
                    discount_hints.append(sub.user.username)
        msg = f'{cancelled} Rechnung(en) storniert.'
        if revoked:
            msg += f' {revoked}× Freischaltung zurückgenommen.'
        if pdf_failed:
            msg += (' Achtung, PDF konnte nicht neu erzeugt werden bei: '
                    f'{", ".join(pdf_failed)} — das abgelegte PDF zeigt dort noch '
                    'keinen Storno-Vermerk.')
        if discount_hints:
            msg += (' Achtung, eingelöster Einmal-Rabatt bei: '
                    f'{", ".join(discount_hints)} — für eine Ersatzrechnung im '
                    'Subscription-Admin per "Rabatt setzen" neu vergeben.')
        self.message_user(request, msg)
