from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('upload', views.upload_file, name='upload'),
    path('analyze_page', views.analyze_page, name='analyze_page'),
    path('project_files/<str:project_id>/<path:filename>', views.serve_project_file, name='serve_project_file'),
]
