import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image, ImageFile
import json
import datetime
import os
import glob

# PIL-Limits erhöhen, um DecompressionBombWarning zu vermeiden
Image.MAX_IMAGE_PIXELS = None  # Warnung deaktivieren
ImageFile.LOAD_TRUNCATED_IMAGES = True  # Erlaubt das Laden von unvollständigen Bildern

# Aktuelles Datum und Zeit für den Dateinamen
timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")

# Dataset-Klasse
class WindowDataset(Dataset):
    def __init__(self, image_folder, annotation_file, transform=None, max_size=1333, use_preprocessing=False):
        with open(annotation_file, 'r') as f:
            self.annotations = json.load(f)
        self.image_folder = image_folder
        self.transform = transform
        self.max_size = max_size  # Max Größe für die längere Seite des Bildes
        self.use_preprocessing = use_preprocessing  # Flag für Preprocessing

    def __len__(self):
        return len(self.annotations)

    def __getitem__(self, idx):
        annotation = self.annotations[idx]
        img_path = f"{self.image_folder}/{annotation['image']}"
        
        # Prüfen, ob Bild existiert
        if not os.path.exists(img_path):
            print(f"Warnung: Bild nicht gefunden: {img_path}")
            # Fallback zu einem anderen Bild oder einem leeren Bild
            if idx > 0:
                return self.__getitem__(idx-1)  # Versuche vorheriges Bild
            else:
                # Erstelle ein leeres Bild mit einer Box
                image = Image.new('RGB', (100, 100))
                boxes = torch.tensor([[10, 10, 50, 50]], dtype=torch.float32)
                labels = torch.tensor([1], dtype=torch.int64)
                return image, {"boxes": boxes, "labels": labels}
        
        # Bild laden
        if self.use_preprocessing:
            # Lese Bilddaten als Bytes
            with open(img_path, 'rb') as f:
                image_bytes = f.read()
            # Wende Preprocessing an
            from image_preprocessing import preprocess_image # Importiere die Funktion
            image = preprocess_image(image_bytes)
        else:
            # Original-Ladecode
            image = Image.open(img_path).convert("RGB")
                
        # Bild auf vernünftige Größe skalieren
        w, h = image.size
        scale = min(self.max_size / max(w, h), 1.0)  # Skalieren, wenn größer als max_size
        if scale < 1.0:
            new_w, new_h = int(w * scale), int(h * scale)
            image = image.resize((new_w, new_h), Image.BILINEAR)
            scale_factor = torch.tensor([scale, scale, scale, scale])
        else:
            scale_factor = torch.tensor([1.0, 1.0, 1.0, 1.0])
        
        # Bounding Boxen und Labels als Tensoren
        boxes = []
        labels = []
        
        for anno in annotation['annotations']:
            # Original-Box-Koordinaten
            box = anno['bbox']
            # Skaliere Koordinaten, wenn Bild skaliert wurde
            if scale < 1.0:
                scaled_box = [
                    box[0] * scale,
                    box[1] * scale,
                    box[2] * scale,
                    box[3] * scale
                ]
                boxes.append(scaled_box)
            else:
                boxes.append(box)
                
            labels.append(anno['category_id'])
        
        # Konvertiere zu Tensoren
        boxes = torch.tensor(boxes, dtype=torch.float32)
        labels = torch.tensor(labels, dtype=torch.int64)
        
        # Target als Dictionary
        target = {"boxes": boxes, "labels": labels}
        
        if self.transform:
            image = self.transform(image)
        
        return image, target
        
# Modell definieren
def get_model(num_classes=6):
    model = models.detection.fasterrcnn_resnet50_fpn(weights='DEFAULT')
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model

# Funktion zum Löschen der Checkpoints
def cleanup_checkpoints(timestamp_pattern):
    """Löscht alle temporären Checkpoint-Dateien mit dem angegebenen Zeitstempel-Muster"""
    checkpoint_pattern = f"fasterrcnn_model/checkpoint_epoch_*_{timestamp_pattern}.pth"
    checkpoint_files = glob.glob(checkpoint_pattern)
    
    if checkpoint_files:
        print(f"Räume {len(checkpoint_files)} temporäre Checkpoint-Dateien auf...")
        for file in checkpoint_files:
            try:
                os.remove(file)
                print(f"  Gelöscht: {file}")
            except Exception as e:
                print(f"  Fehler beim Löschen von {file}: {e}")
    else:
        print("Keine temporären Checkpoint-Dateien zum Aufräumen gefunden.")

# Hauptfunktion für das Training
def train_model(image_folder, annotation_file, num_epochs=10, batch_size=2, 
               output_path=f"fasterrcnn_model/fasterrcnn_model_{timestamp}.pth",
               use_gpu=True, max_image_size=1333, save_checkpoints=True):
    # Stelle sicher, dass der Ausgabeordner existiert
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    # Transformationen
    transform = transforms.Compose([transforms.ToTensor()])
    
    # Dataset und DataLoader einrichten
    dataset = WindowDataset(image_folder, annotation_file, transform, max_size=max_image_size, use_preprocessing=True)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True, 
                           collate_fn=lambda batch: tuple(zip(*batch)))
    
    # Modell, Gerät und Optimizer einrichten
    device = torch.device('cuda') if torch.cuda.is_available() and use_gpu else torch.device('cpu')
    print(f"Training auf: {device}")
    
    model = get_model()
    model.to(device)
    
    # Optimizer mit Lernrate und Weight Decay einstellen
    optimizer = torch.optim.SGD(model.parameters(), lr=0.005, momentum=0.9, weight_decay=0.0005)
    
    # Learning rate scheduler hinzufügen
    lr_scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)
    
    # Liste zum Speichern der Checkpoint-Pfade
    checkpoint_files = []
    
    try:
        # Training
        print(f"Starte Training mit {len(dataset)} Bildern, Batch-Größe: {batch_size}")
        for epoch in range(num_epochs):
            model.train()
            epoch_loss = 0
            batch_count = 0
            
            for images, targets in dataloader:
                batch_count += 1
                try:
                    # Bilder und Targets auf das Gerät verschieben
                    images = list(image.to(device) for image in images)
                    targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
                    
                    # Optimizer zurücksetzen
                    optimizer.zero_grad()
                    
                    # Forward pass
                    loss_dict = model(images, targets)
                    losses = sum(loss for loss in loss_dict.values())
                    
                    # Backward pass
                    losses.backward()
                    optimizer.step()
                    
                    # Verlust aufzeichnen
                    epoch_loss += losses.item()
                    
                    # Zwischenstatus ausgeben
                    if batch_count % 5 == 0:
                        print(f"  Batch {batch_count}, Verlust: {losses.item():.4f}")
                    
                except RuntimeError as e:
                    if "out of memory" in str(e):
                        print(f"Warning: Out of memory in batch {batch_count}. Überspringen...")
                        torch.cuda.empty_cache()  # GPU-Speicher freigeben
                        continue
                    else:
                        raise e
            
            # Learning rate anpassen
            lr_scheduler.step()
            
            print(f"Epoch #{epoch} Durchschnittsverlust: {epoch_loss / batch_count:.4f}")
            
            # Modell nach jeder Epoche speichern (optionaler Checkpoint)
            if save_checkpoints:
                checkpoint_path = f"fasterrcnn_model/checkpoint_epoch_{epoch}_{timestamp}.pth"
                torch.save(model.state_dict(), checkpoint_path)
                checkpoint_files.append(checkpoint_path)
                print(f"Checkpoint gespeichert: {checkpoint_path}")
        
        # Finales Modell speichern
        torch.save(model.state_dict(), output_path)
        print(f"Modell erfolgreich gespeichert unter {output_path}")
        
        # Lösche die Checkpoints, wenn das Training erfolgreich war
        if save_checkpoints:
            print("Training erfolgreich abgeschlossen. Lösche temporäre Checkpoints...")
            for checkpoint in checkpoint_files:
                try:
                    os.remove(checkpoint)
                    print(f"  Gelöscht: {checkpoint}")
                except Exception as e:
                    print(f"  Fehler beim Löschen von {checkpoint}: {e}")
        
        return True  # Training erfolgreich
        
    except Exception as e:
        print(f"Fehler während des Trainings: {e}")
        print(f"Checkpoint-Dateien wurden behalten für mögliche Wiederaufnahme des Trainings.")
        return False  # Training fehlgeschlagen

if __name__ == "__main__":
    # Hier kannst du Kommandozeilenargumente verarbeiten oder feste Werte verwenden
    success = train_model(
        image_folder='Trainingsdaten/image',
        annotation_file='Trainingsdaten/json/combined_labels_2025-04-20-18-37-53.json',
        batch_size=2,         # Reduziere Batch-Größe auf 2
        num_epochs=15,        # Mehr Epochen für besseres Training
        max_image_size=800,   # Begrenze die Bildgröße
        use_gpu=True,         # Auf False setzen, wenn CUDA-Probleme bestehen bleiben
        save_checkpoints=True # Checkpoints während des Trainings speichern
    )
    
    # Alternative Methode zum Aufräumen der Checkpoints, falls du lieber alle möglichen Checkpoints löschen möchtest
    # Anstatt die im Training erstellten zu tracken
    if success:
        cleanup_checkpoints(timestamp)