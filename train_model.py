import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image, ImageDraw
import json
import datetime
import os
import numpy as np
from shapely.geometry import Polygon

# Aktuelles Datum und Zeit für den Dateinamen
timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")

# Dataset-Klasse mit Unterstützung für COCO und VGG Format sowie Rechteck- und Polygon-Annotationen
class WindowDataset(Dataset):
    def __init__(self, image_folder, annotation_files, transform=None):
        self.annotations = []
        self.image_folder = image_folder
        self.transform = transform
        
        for annotation_file in annotation_files if isinstance(annotation_files, list) else [annotation_files]:
            with open(annotation_file, 'r') as f:
                json_data = json.load(f)
                
                # COCO-Format Erkennung (Liste von Bildern mit Annotationen)
                if isinstance(json_data, list):
                    self.annotations.extend(json_data)
                
                # VGG-Format Erkennung (Dict mit Bildern als Schlüssel)
                elif isinstance(json_data, dict):
                    for image_name, image_data in json_data.items():
                        # Konvertiere VGG-Format in unser internes Format
                        image_annotations = []
                        
                        if 'regions' in image_data:
                            for region_id, region_data in image_data['regions'].items():
                                anno = {}
                                shape_attrs = region_data['shape_attributes']
                                region_attrs = region_data.get('region_attributes', {})
                                
                                # Kategorie-ID aus Label ableiten (falls vorhanden)
                                category_id = 1  # Standard-Kategorie
                                if 'label' in region_attrs:
                                    label = region_attrs['label']
                                    # Du kannst hier eine Mapping-Funktion einbauen
                                    if label.lower() == "wand":
                                        category_id = 0
                                
                                # Polygon-Form
                                if shape_attrs['name'] == 'polygon':
                                    anno['polygon'] = {
                                        'all_points_x': shape_attrs['all_points_x'],
                                        'all_points_y': shape_attrs['all_points_y']
                                    }
                                    # Berechne auch die Bounding Box für das Polygon
                                    x_min = min(shape_attrs['all_points_x'])
                                    y_min = min(shape_attrs['all_points_y'])
                                    x_max = max(shape_attrs['all_points_x'])
                                    y_max = max(shape_attrs['all_points_y'])
                                    anno['bbox'] = [x_min, y_min, x_max, y_max]
                                
                                # Rechteck-Form
                                elif shape_attrs['name'] == 'rect':
                                    x = shape_attrs['x']
                                    y = shape_attrs['y']
                                    width = shape_attrs['width']
                                    height = shape_attrs['height']
                                    anno['bbox'] = [x, y, x + width, y + height]
                                
                                anno['category_id'] = category_id
                                image_annotations.append(anno)
                        
                        self.annotations.append({
                            'image': image_name,
                            'annotations': image_annotations
                        })

    def __len__(self):
        return len(self.annotations)

    def __getitem__(self, idx):
        annotation = self.annotations[idx]
        image_path = os.path.join(self.image_folder, annotation['image'])
        image = Image.open(image_path).convert("RGB")
        
        # Sammle alle Bounding-Boxen und Labels
        boxes = []
        labels = []
        
        for anno in annotation['annotations']:
            # Unterstützung für verschiedene Box-Formate
            if 'bbox' in anno:
                box = anno['bbox']
                # Standardisiere das Format auf [x_min, y_min, x_max, y_max]
                if len(box) == 4:
                    # Prüfen ob es im Format [x, y, width, height] ist
                    if box[2] < box[0] or box[3] < box[1]:
                        # Nein, es ist bereits [x_min, y_min, x_max, y_max]
                        bbox = box
                    else:
                        # Ja, es ist [x, y, width, height], konvertiere zu [x_min, y_min, x_max, y_max]
                        bbox = [box[0], box[1], box[0] + box[2], box[1] + box[3]]
                else:
                    continue  # Ungültiges Box-Format
                    
                boxes.append(bbox)
                labels.append(anno['category_id'])
            
            # Unterstützung für Polygon-Format
            elif 'polygon' in anno:
                polygon = anno['polygon']
                # Wandle Polygon in Bounding Box um
                x_min = min(polygon['all_points_x'])
                y_min = min(polygon['all_points_y'])
                x_max = max(polygon['all_points_x'])
                y_max = max(polygon['all_points_y'])
                boxes.append([x_min, y_min, x_max, y_max])
                labels.append(anno['category_id'])
        
        # Konvertiere zu Tensoren
        if len(boxes) > 0:
            boxes = torch.tensor(boxes, dtype=torch.float32)
            labels = torch.tensor(labels, dtype=torch.int64)
        else:
            # Fallback, wenn keine Annotationen vorhanden sind
            boxes = torch.zeros((0, 4), dtype=torch.float32)
            labels = torch.zeros(0, dtype=torch.int64)
        
        # Target als Dictionary
        target = {"boxes": boxes, "labels": labels}
        
        if self.transform:
            image = self.transform(image)
        
        return image, target

# Modell definieren
def get_model(num_classes=2):
    model = models.detection.fasterrcnn_resnet50_fpn(weights='DEFAULT')
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model

# Hauptfunktion für das Training
def train_model(image_folder, annotation_files, num_epochs=10, batch_size=4, output_path=None):
    if output_path is None:
        output_path = f"fasterrcnn_model/fasterrcnn_model_{timestamp}.pth"
        
    # Transformationen
    transform = transforms.Compose([transforms.ToTensor()])
    
    # Dataset und DataLoader einrichten
    dataset = WindowDataset(image_folder, annotation_files, transform)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True, 
                           collate_fn=lambda batch: tuple(zip(*batch)))
    
    print(f"Datensatz geladen: {len(dataset)} Bilder")
    
    # Modell, Gerät und Optimizer einrichten
    device = torch.device('cuda') if torch.cuda.is_available() else torch.device('cpu')
    print(f"Training auf Gerät: {device}")
    
    model = get_model()
    model.to(device)
    
    # Optimierer und Scheduler für bessere Konvergenz
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.SGD(params, lr=0.005, momentum=0.9, weight_decay=0.0005)
    lr_scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)
    
    # Training
    print("Training startet...")
    for epoch in range(num_epochs):
        model.train()
        epoch_loss = 0
        
        for images, targets in dataloader:
            images = list(image.to(device) for image in images)
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            
            # Verhindere leere Bounding-Boxen
            valid_batch = True
            for t in targets:
                if t['boxes'].numel() == 0:
                    valid_batch = False
                    break
            
            if not valid_batch:
                continue
                
            # Forward-Pass
            loss_dict = model(images, targets)
            losses = sum(loss for loss in loss_dict.values())
            
            # Backpropagation
            optimizer.zero_grad()
            losses.backward()
            optimizer.step()
            
            epoch_loss += losses.item()
        
        # Lernrate anpassen
        lr_scheduler.step()
        
        print(f"Epoch #{epoch+1}/{num_epochs} Loss: {epoch_loss / len(dataloader):.4f}")
    
    # Modell speichern
    torch.save(model.state_dict(), output_path)
    print(f"Modell gespeichert unter {output_path}")
    
    return model

# Evaluierungsfunktion
def evaluate_model(model, image_folder, annotation_file, device=None):
    if device is None:
        device = torch.device('cuda') if torch.cuda.is_available() else torch.device('cpu')
    
    model.to(device)
    model.eval()
    
    # Dataset für Evaluierung
    transform = transforms.Compose([transforms.ToTensor()])
    dataset = WindowDataset(image_folder, annotation_file, transform)
    dataloader = DataLoader(dataset, batch_size=1, shuffle=False, 
                           collate_fn=lambda batch: tuple(zip(*batch)))
    
    results = []
    with torch.no_grad():
        for images, targets in dataloader:
            images = list(img.to(device) for img in images)
            
            outputs = model(images)
            
            # Konvertiere Ausgaben zu CPU für weitere Verarbeitung
            outputs = [{k: v.cpu() for k, v in t.items()} for t in outputs]
            results.append((outputs, targets))
    
    # Hier könntest du Metriken wie mAP berechnen
    print(f"Evaluierung abgeschlossen für {len(dataset)} Bilder")
    return results

# Beispiel für die Verwendung
if __name__ == "__main__":
    # Mehrere Annotationsdateien können verwendet werden
    annotation_files = [
        'Trainingsdaten/json/labels_25010-weierwies-5-weiningen_2025-04-20-01-08-05.json',
        'Trainingsdaten/json/combined_labels_2025-04-20-12-21-42.json'
    ]
    
    # Training
    model = train_model(
        image_folder='Trainingsdaten/image',
        annotation_files=annotation_files,
        num_epochs=15,
        batch_size=2
    )
    
    # Optional: Evaluierung
    evaluate_model(model, 'Testdaten/image', 'Testdaten/annotations.json')