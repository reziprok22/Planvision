from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect

from .forms import EmailUserCreationForm
from .models import subscription_for


def register(request):
    if request.user.is_authenticated:
        return redirect('app')
    if request.method == 'POST':
        form = EmailUserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            subscription_for(user)  # Trial startet mit der Registrierung
            login(request, user)
            messages.success(request, 'Konto erfolgreich erstellt.')
            return redirect('app')
    else:
        form = EmailUserCreationForm()
    return render(request, 'accounts/register.html', {'form': form})


@login_required
def konto(request):
    return render(request, 'accounts/konto.html', {
        'sub': subscription_for(request.user),
        'price_chf': settings.LICENSE_PRICE_CHF,
    })
