import atexit
import gc
from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = 'core'

    def ready(self):
        from model_handler import load_model, cleanup_memory
        try:
            load_model()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error loading model: {e}")

        def on_exit():
            cleanup_memory()
            gc.collect()

        atexit.register(on_exit)
