import logging
from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = 'core'

    def ready(self):
        from model_handler import load_local_model, uses_local_model
        # Mit GPU-Dienst (Produktion) wird lokal nie gerechnet — kein Modell laden
        if not uses_local_model():
            return
        try:
            load_local_model()
        except Exception as e:
            logging.getLogger(__name__).error(f"Error loading model: {e}")
