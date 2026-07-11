from datetime import timedelta

from django.contrib import admin
from django.utils import timezone

from .models import Subscription


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'status_label', 'trial_ends', 'paid_until', 'created_at')
    search_fields = ('user__username',)
    actions = ('extend_one_year',)

    @admin.display(description='Status')
    def status_label(self, obj):
        return obj.status_label

    @admin.action(description='Um 1 Jahr verlängern (Zahlung eingegangen)')
    def extend_one_year(self, request, queryset):
        today = timezone.localdate()
        for sub in queryset:
            base = sub.paid_until if (sub.paid_until and sub.paid_until > today) else today
            sub.paid_until = base + timedelta(days=365)
            sub.save(update_fields=['paid_until'])
        self.message_user(request, f'{queryset.count()} Abo(s) um 1 Jahr verlängert.')
