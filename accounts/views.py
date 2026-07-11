from django.shortcuts import render, redirect
from django.contrib.auth import login
from django.contrib import messages

from .forms import EmailUserCreationForm


def register(request):
    if request.user.is_authenticated:
        return redirect('app')
    if request.method == 'POST':
        form = EmailUserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, 'Konto erfolgreich erstellt.')
            return redirect('app')
    else:
        form = EmailUserCreationForm()
    return render(request, 'accounts/register.html', {'form': form})
