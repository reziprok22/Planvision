from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.core.mail import EmailMultiAlternatives
from django.shortcuts import render, redirect
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from .forms import EmailUserCreationForm
from .models import subscription_for
from .tokens import email_verification_token


def _send_verification_email(request, user):
    context = {
        'domain': request.get_host(),
        'protocol': 'https' if request.is_secure() else 'http',
        'uid': urlsafe_base64_encode(force_bytes(user.pk)),
        'token': email_verification_token.make_token(user),
    }
    subject = render_to_string('accounts/verify_email_subject.txt', context).strip()
    text_body = render_to_string('accounts/verify_email_email.txt', context)
    html_body = render_to_string('accounts/verify_email_email.html', context)
    message = EmailMultiAlternatives(subject, text_body, to=[user.email])
    message.attach_alternative(html_body, 'text/html')
    message.send()


def register(request):
    if request.user.is_authenticated:
        return redirect('app')
    if request.method == 'POST':
        form = EmailUserCreationForm(request.POST)
        if form.is_valid():
            user = form.save(commit=False)
            user.is_active = False  # erst nach Klick auf den Bestätigungslink
            user.save()
            subscription_for(user)  # Trial startet mit der Registrierung
            _send_verification_email(request, user)
            return redirect('verify_email_sent')
    else:
        form = EmailUserCreationForm()
    return render(request, 'accounts/register.html', {'form': form})


def verify_email_sent(request):
    return render(request, 'accounts/verify_email_sent.html')


def verify_email(request, uidb64, token):
    """Bewusst ohne Auto-Login: der Mail-Link wäre sonst ein Session-Ticket
    für jeden, der ihn abgreift (weitergeleitete Mail, geteiltes Postfach)."""
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uidb64)))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    if user is not None and email_verification_token.check_token(user, token):
        user.is_active = True
        user.save()
        return render(request, 'accounts/verify_email_done.html')

    # Token verbraucht, Konto aber schon aktiv: Mail-Scanner (z.B. Outlook
    # SafeLinks) rufen Links vorab per GET auf und konsumieren den Token,
    # bevor der User klickt. Dann nicht "ungültig" zeigen, sondern zum
    # Login führen.
    if user is not None and user.is_active:
        return render(request, 'accounts/verify_email_done.html')

    return render(request, 'accounts/verify_email_invalid.html')


@login_required
def konto(request):
    return render(request, 'accounts/konto.html', {
        'sub': subscription_for(request.user),
        'price_chf': settings.LICENSE_PRICE_CHF,
    })
