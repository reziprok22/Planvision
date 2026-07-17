from django.contrib import admin

from .models import Project, BugReport, AnalysisEvent, FeedbackResponse


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'user', 'original_filename', 'consent_training', 'files_deleted')
    list_filter = ('consent_training', 'files_deleted', 'created_at')
    search_fields = ('original_filename', 'user__username')
    readonly_fields = ('id', 'created_at')


@admin.register(AnalysisEvent)
class AnalysisEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'user', 'session_key', 'page_number')
    list_filter = ('created_at',)
    readonly_fields = ('created_at', 'session_key', 'user', 'page_number')


@admin.register(FeedbackResponse)
class FeedbackResponseAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'user', 'short_positive', 'short_improve', 'short_missing', 'reward_granted')
    list_filter = ('reward_granted', 'created_at')
    search_fields = ('positive', 'improve', 'missing', 'user__username')
    readonly_fields = ('user', 'positive', 'improve', 'missing', 'reward_granted', 'created_at')

    @admin.display(description='Was ist gut?')
    def short_positive(self, obj):
        return obj.positive[:60]

    @admin.display(description='Was muss besser werden?')
    def short_improve(self, obj):
        return obj.improve[:60]

    @admin.display(description='Was fehlt?')
    def short_missing(self, obj):
        return obj.missing[:60]


@admin.register(BugReport)
class BugReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'created_at', 'report_type', 'user', 'email', 'page_number', 'short_text', 'has_zip', 'has_screenshot', 'resolved')
    list_editable = ('resolved',)
    list_filter = ('report_type', 'resolved', 'created_at')
    search_fields = ('text', 'user__username', 'email')
    readonly_fields = ('user', 'report_type', 'text', 'email', 'page_number', 'user_agent', 'client_info', 'project_zip', 'screenshot', 'created_at')

    @admin.display(description='Beschreibung')
    def short_text(self, obj):
        return obj.text[:80]

    @admin.display(boolean=True, description='Projekt-ZIP')
    def has_zip(self, obj):
        return bool(obj.project_zip)

    @admin.display(boolean=True, description='Screenshot')
    def has_screenshot(self, obj):
        return bool(obj.screenshot)
