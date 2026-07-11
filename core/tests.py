import tempfile
from datetime import timedelta
from pathlib import Path

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import subscription_for
from .models import StoredProject

CLOUD_TMP = Path(tempfile.mkdtemp(prefix='planli_cloud_test_'))


def _zip(content=b'PK\x03\x04 fake zip'):
    return SimpleUploadedFile('project.planli', content, content_type='application/zip')


@override_settings(CLOUD_PROJECTS_DIR=CLOUD_TMP)
class CloudStorageTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='test@example.ch', email='test@example.ch', password='pw')
        self.client.login(username='test@example.ch', password='pw')

    def _save(self, **extra):
        data = {'project_zip': _zip(), 'name': 'EFH Muster', **extra}
        return self.client.post(reverse('cloud_save'), data)

    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get(reverse('cloud_list')).status_code, 401)
        self.assertEqual(self.client.post(reverse('cloud_save')).status_code, 401)

    def test_save_and_list(self):
        response = self._save()
        self.assertEqual(response.status_code, 200)
        project_id = response.json()['id']
        self.assertTrue((CLOUD_TMP / f'{project_id}.planli').exists())

        data = self.client.get(reverse('cloud_list')).json()
        self.assertEqual(len(data['projects']), 1)
        self.assertEqual(data['projects'][0]['name'], 'EFH Muster')
        self.assertEqual(data['limit'], 50)

    def test_save_with_id_overwrites(self):
        project_id = self._save().json()['id']
        response = self._save(project_id=project_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(StoredProject.objects.count(), 1)

    def test_quota_blocks_new_but_allows_overwrite(self):
        sub = subscription_for(self.user)
        sub.max_projects = 1
        sub.save()
        project_id = self._save().json()['id']
        response = self._save()  # zweites Projekt → Limit
        self.assertEqual(response.status_code, 403)
        self.assertIn('Projektlimit erreicht (1', response.json()['error'])
        # Überschreiben des bestehenden bleibt möglich
        self.assertEqual(self._save(project_id=project_id).status_code, 200)

    @override_settings(MAX_PROJECT_MB=0)
    def test_size_cap(self):
        response = self._save()
        self.assertEqual(response.status_code, 413)

    def test_download_and_ownership(self):
        project_id = self._save().json()['id']
        response = self.client.get(f'/cloud/projects/{project_id}/download')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'PK\x03\x04 fake zip')
        # last_opened_at wird gesetzt (Basis der späteren Archivierung)
        self.assertIsNotNone(StoredProject.objects.get(id=project_id).last_opened_at)

        # Fremder User sieht das Projekt nicht
        User.objects.create_user(username='b@example.ch', password='pw')
        self.client.login(username='b@example.ch', password='pw')
        self.assertEqual(self.client.get(f'/cloud/projects/{project_id}/download').status_code, 404)
        self.assertEqual(self.client.post(f'/cloud/projects/{project_id}/delete').status_code, 404)

    def test_rename_and_delete(self):
        project_id = self._save().json()['id']
        response = self.client.post(f'/cloud/projects/{project_id}/rename', {'name': 'MFH Neu'})
        self.assertEqual(response.json()['name'], 'MFH Neu')

        self.client.post(f'/cloud/projects/{project_id}/delete')
        self.assertEqual(StoredProject.objects.count(), 0)
        self.assertFalse((CLOUD_TMP / f'{project_id}.planli').exists())

    @override_settings(BETA_MODE=False)
    def test_read_only_user_cannot_save_but_can_open_and_delete(self):
        project_id = self._save().json()['id']
        sub = subscription_for(self.user)
        sub.trial_ends = timezone.now() - timedelta(days=1)
        sub.save()
        response = self._save()
        self.assertEqual(response.status_code, 403)
        self.assertIn('abgelaufen', response.json()['error'])
        # Ansehen (Download) und Löschen bleiben erlaubt
        self.assertEqual(self.client.get(f'/cloud/projects/{project_id}/download').status_code, 200)
        self.assertEqual(self.client.post(f'/cloud/projects/{project_id}/delete').status_code, 200)

    @override_settings(BETA_MODE=False)
    def test_app_view_enables_cloud_for_logged_in(self):
        response = self.client.get(reverse('app'))
        self.assertContains(response, 'window.PLANLI_CLOUD = true')
        self.assertContains(response, 'cloudDashboard')
