"""Kontobezogener Mailversand.

Eigenes Modul, weil den Bestätigungslink zwei Stellen verschicken: die
Registrierung (accounts/views.py) und der Passwort-Reset (accounts/forms.py),
wenn das Konto noch gar nicht bestätigt ist. Läge die Funktion in views.py,
entstünde mit forms.py ein Zirkelimport.
"""
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from .tokens import email_verification_token


def send_verification_email(request, user):
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
