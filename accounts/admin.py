from datetime import timedelta

from django import forms
from django.contrib import admin
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.shortcuts import render
from django.utils import timezone

from .models import DISCOUNT_SCOPES, Subscription


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
    # Rabatt und Projektlimit direkt in der Liste anpassbar (Basispreis und
    # Grund über das Formular, damit die Liste schmal bleibt)
    list_editable = ('max_projects', 'discount_percent', 'discount_scope')
    list_filter = (EmailVerifiedFilter, 'discount_scope')
    search_fields = ('user__username',)
    actions = ('extend_one_year', 'set_discount')

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

    @admin.action(description='Um 1 Jahr verlängern (Zahlung eingegangen)')
    def extend_one_year(self, request, queryset):
        today = timezone.localdate()
        consumed = 0
        pinned = 0
        for sub in queryset:
            base = sub.paid_until if (sub.paid_until and sub.paid_until > today) else today
            sub.paid_until = base + timedelta(days=365)
            fields = ['paid_until']
            # Einmalige Rabatte gelten genau für diese eine Jahreslizenz.
            if sub.consume_discount():
                fields.append('discount_used_at')
                consumed += 1
            # Preisgarantie: mit der ersten Rechnung wird der dann gültige
            # Listenpreis festgeschrieben.
            if sub.pin_list_price():
                fields.append('list_price_chf')
                pinned += 1
            sub.save(update_fields=fields)
        msg = f'{queryset.count()} Abo(s) um 1 Jahr verlängert.'
        if pinned:
            msg += f' {pinned}× Preis festgeschrieben.'
        if consumed:
            msg += f' {consumed} einmalige(r) Rabatt(e) als eingelöst markiert.'
        self.message_user(request, msg)

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
