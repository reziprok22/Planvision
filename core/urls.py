from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing, name='landing'),
    path('robots.txt', views.robots_txt, name='robots_txt'),
    path('sitemap.xml', views.sitemap_xml, name='sitemap_xml'),
    path('app/', views.app, name='app'),
    path('datenschutz/', views.datenschutz, name='datenschutz'),
    path('impressum/', views.impressum, name='impressum'),
    path('agb/', views.agb, name='agb'),
    path('statistik/', views.statistik, name='statistik'),
    path('upload', views.upload_file, name='upload'),
    path('analyze_page', views.analyze_page, name='analyze_page'),
    path('save_training_data', views.save_training_data, name='save_training_data'),
    path('report_bug', views.report_bug, name='report_bug'),
    path('project_files/<str:project_id>/<path:filename>', views.serve_project_file, name='serve_project_file'),
]
