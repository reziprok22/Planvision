from datetime import timedelta

from django.contrib import admin
from django.utils import timezone

from .models import Subscription


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
                    'trial_ends', 'paid_until', 'max_projects', 'created_at')
    list_editable = ('max_projects',)  # Projektlimit direkt in der Liste anpassbar
    list_filter = (EmailVerifiedFilter,)
    search_fields = ('user__username',)
    actions = ('extend_one_year',)

    @admin.display(description='Status')
    def status_label(self, obj):
        return obj.status_label

    @admin.display(description='E-Mail bestätigt', boolean=True)
    def email_verified(self, obj):
        return obj.email_verified_at is not None

    @admin.action(description='Um 1 Jahr verlängern (Zahlung eingegangen)')
    def extend_one_year(self, request, queryset):
        today = timezone.localdate()
        for sub in queryset:
            base = sub.paid_until if (sub.paid_until and sub.paid_until > today) else today
            sub.paid_until = base + timedelta(days=365)
            sub.save(update_fields=['paid_until'])
        self.message_user(request, f'{queryset.count()} Abo(s) um 1 Jahr verlängert.')
