from django.db import migrations


def raise_default_limit(apps, schema_editor):
    """Bestandskonten vom alten Default 50 auf den neuen Default 100 heben.

    max_projects wird beim Anlegen fest gespeichert, eine Änderung von
    DEFAULT_MAX_PROJECTS trifft also nur neue Konten. Gehoben wird nur genau
    50 — wer im Admin bewusst einen anderen Wert bekommen hat, behält ihn.
    """
    Subscription = apps.get_model('accounts', 'Subscription')
    Subscription.objects.filter(max_projects=50).update(max_projects=100)


def lower_default_limit(apps, schema_editor):
    Subscription = apps.get_model('accounts', 'Subscription')
    Subscription.objects.filter(max_projects=100).update(max_projects=50)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0008_invoice_previous_paid_until'),
    ]

    operations = [
        migrations.RunPython(raise_default_limit, lower_default_limit),
    ]
