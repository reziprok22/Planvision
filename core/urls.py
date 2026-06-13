from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing, name='landing'),
    path('app/', views.app, name='app'),
    path('datenschutz/', views.datenschutz, name='datenschutz'),
    path('impressum/', views.impressum, name='impressum'),
    path('agb/', views.agb, name='agb'),
    path('upload', views.upload_file, name='upload'),
    path('analyze_page', views.analyze_page, name='analyze_page'),
    path('save_training_data', views.save_training_data, name='save_training_data'),
    path('report_bug', views.report_bug, name='report_bug'),
    path('project_files/<str:project_id>/<path:filename>', views.serve_project_file, name='serve_project_file'),
]
