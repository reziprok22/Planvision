from django.contrib import admin

from .models import Project, BugReport, AnalysisEvent


admin.site.register(Project)


@admin.register(AnalysisEvent)
class AnalysisEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'user', 'session_key', 'page_number')
    list_filter = ('created_at',)
    readonly_fields = ('created_at', 'session_key', 'user', 'page_number')


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'user', 'page_number', 'short_text', 'has_zip', 'has_screenshot', 'resolved')
    list_editable = ('resolved',)
    list_filter = ('resolved', 'created_at')
    search_fields = ('text', 'user__username')
    readonly_fields = ('user', 'text', 'page_number', 'user_agent', 'project_zip', 'screenshot', 'created_at')

    @admin.display(description='Beschreibung')
    def short_text(self, obj):
        return obj.text[:80]

    @admin.display(boolean=True, description='Projekt-ZIP')
    def has_zip(self, obj):
        return bool(obj.project_zip)

    @admin.display(boolean=True, description='Screenshot')
    def has_screenshot(self, obj):
        return bool(obj.screenshot)
