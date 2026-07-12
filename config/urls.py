from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    # Bewusst nicht /admin/: hält Scanner-Bots fern, die Standard-Pfade
    # abklopfen. Der Pfad darf nirgends öffentlich auftauchen (robots.txt!).
    path('vitruv/', admin.site.urls),
    path('accounts/', include('accounts.urls')),
    path('', include('core.urls')),
]
