import torch
from torch.utils.data import Dataset, DataLoader, random_split
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image, ImageDraw
import json
import datetime
import os
import numpy as np
from shapely.geometry import Polygon
import matplotlib.pyplot as plt

# Aktuelles Datum und Zeit für den Dateinamen
timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")

# Dataset-Klasse mit Unterstützung für COCO und VGG Format sowie Rechteck- und Polygon-Annotationen
class WindowDataset(Dataset):
    def __init__(self, image_folder, annotation_files, transform=None):
        self.annotations = []
        self.image_folder = image_folder
        self.transform = transform
        
        for annotation_file in annotation_files if isinstance(annotation_files, list) else [annotation_files]:
            print(f"Lade Annotationsdatei: {annotation_file}")
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
                                category_id = 1  # Standard-Kategorie (Fenster)
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
        
        print(f"Insgesamt {len(self.annotations)} Bilder mit Annotationen geladen")
        # Zähle Instanzen nach Kategorie
        fenster_count = 0
        wand_count = 0
        for ann in self.annotations:
            for obj in ann['annotations']:
                if obj['category_id'] == 1:
                    fenster_count += 1
                elif obj['category_id'] == 0:
                    wand_count += 1
        print(f"Enthält {fenster_count} Fenster-Annotationen und {wand_count} Wand-Annotationen")

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

# Funktion zur Auswertung des Modells auf dem Validierungsdatensatz
def validate_model(model, dataloader, device):
    model.eval()
    validation_loss = 0
    
    with torch.no_grad():
        for images, targets in dataloader:
            images = list(image.to(device) for image in images)
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            
            # Überspringe Batches mit leeren Bounding-Boxen
            valid_batch = True
            for t in targets:
                if t['boxes'].numel() == 0:
                    valid_batch = False
                    break
            
            if not valid_batch:
                continue
            
            # Wir müssen das Modell explizit in den Trainingsmodus versetzen, 
            # um Verluste zu berechnen, dann wieder zurück in den Evaluierungsmodus
            model.train()
            loss_dict = model(images, targets)
            model.eval()
            
            losses = sum(loss for loss in loss_dict.values())
            validation_loss += losses.item()
    
    # Durchschnittlichen Validierungsverlust berechnen
    avg_validation_loss = validation_loss / max(len(dataloader), 1)
    return avg_validation_loss

# Funktion zum Plotten von Trainings- und Validierungsverlust
def plot_losses(train_losses, val_losses, output_path=None):
    plt.figure(figsize=(10, 5))
    plt.plot(train_losses, label='Training Loss')
    plt.plot(val_losses, label='Validation Loss')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.title('Training und Validation Loss')
    plt.legend()
    plt.grid(True)
    
    if output_path:
        plt.savefig(output_path)
    plt.show()

# Hauptfunktion für das Training
def train_model(image_folder, annotation_files, num_epochs=25, batch_size=4, 
                output_path=None, val_split=0.2, patience=5):
    if output_path is None:
        # Erstelle Ausgabeordner, falls er nicht existiert
        os.makedirs("fasterrcnn_model", exist_ok=True)
        output_path = f"fasterrcnn_model/fasterrcnn_model_{timestamp}.pth"
    
    # Ausgabepfad für das beste Modell
    best_model_path = f"fasterrcnn_model/best_model_{timestamp}.pth"
    
    # Transformationen
    transform = transforms.Compose([transforms.ToTensor()])
    
    # Dataset einrichten
    full_dataset = WindowDataset(image_folder, annotation_files, transform)
    
    # Aufteilen in Trainings- und Validierungsdaten
    val_size = int(len(full_dataset) * val_split)
    train_size = len(full_dataset) - val_size
    train_dataset, val_dataset = random_split(full_dataset, [train_size, val_size])
    
    # DataLoader einrichten
    train_dataloader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, 
                                collate_fn=lambda batch: tuple(zip(*batch)))
    val_dataloader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False, 
                               collate_fn=lambda batch: tuple(zip(*batch)))
    
    print(f"Datensatz geladen: {train_size} Trainingsbilder, {val_size} Validierungsbilder")
    
    # Modell, Gerät und Optimizer einrichten
    device = torch.device('cuda') if torch.cuda.is_available() else torch.device('cpu')
    print(f"Training auf Gerät: {device}")
    
    model = get_model()
    model.to(device)
    
    # Optimierer und Scheduler für bessere Konvergenz
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.SGD(params, lr=0.005, momentum=0.9, weight_decay=0.0005)
    lr_scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)
    
    # Early Stopping Parameter
    best_val_loss = float('inf')
    no_improvement_count = 0
    
    # Listen für Verlauf
    train_losses = []
    val_losses = []
    
    # Training
    print("Training startet...")
    for epoch in range(num_epochs):
        model.train()
        epoch_loss = 0
        batch_count = 0
        
        for images, targets in train_dataloader:
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
            batch_count += 1
            
            # Fortschritt anzeigen
            if batch_count % 5 == 0:
                print(f"  Batch {batch_count}/{len(train_dataloader)}, Loss: {losses.item():.4f}")
        
        # Durchschnittlichen Trainingsverlust berechnen
        avg_train_loss = epoch_loss / max(batch_count, 1)
        train_losses.append(avg_train_loss)
        
        # Validierung durchführen
        val_loss = validate_model(model, val_dataloader, device)
        val_losses.append(val_loss)
        
        # Lernrate anpassen
        lr_scheduler.step()
        
        print(f"Epoch #{epoch+1}/{num_epochs} Train Loss: {avg_train_loss:.4f}, Val Loss: {val_loss:.4f}")
        
        # Early Stopping Check
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            no_improvement_count = 0
            # Bestes Modell speichern
            torch.save(model.state_dict(), best_model_path)
            print(f"  Neues bestes Modell gespeichert (Val Loss: {val_loss:.4f})")
        else:
            no_improvement_count += 1
            print(f"  Keine Verbesserung seit {no_improvement_count} Epochen")
            if no_improvement_count >= patience:
                print(f"Early Stopping nach {epoch+1} Epochen, da keine Verbesserung seit {patience} Epochen")
                break
    
    # Finales Modell speichern
    torch.save(model.state_dict(), output_path)
    print(f"Finales Modell gespeichert unter {output_path}")
    print(f"Bestes Modell gespeichert unter {best_model_path}")
    
    # Verlauf plotten
    loss_plot_path = f"fasterrcnn_model/training_loss_{timestamp}.png"
    plot_losses(train_losses, val_losses, loss_plot_path)
    print(f"Verlaufsdiagramm gespeichert unter {loss_plot_path}")
    
    # Lade das beste Modell für die Rückgabe
    model.load_state_dict(torch.load(best_model_path))
    
    return model, train_losses, val_losses

# Evaluierungsfunktion
def evaluate_model(model, image_folder, annotation_file, device=None, confidence_threshold=0.5):
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
    metrics = {'true_positives': 0, 'false_positives': 0, 'false_negatives': 0}
    
    with torch.no_grad():
        for i, (images, targets) in enumerate(dataloader):
            image = images[0].to(device)
            
            # Vorhersage
            prediction = model([image])
            prediction = [{k: v.cpu().numpy() for k, v in t.items()} for t in prediction][0]
            
            # Ground Truth
            target = {k: v.cpu().numpy() for k, v in targets[0].items()}
            
            # Verarbeite Vorhersagen mit Konfidenz über dem Schwellenwert
            boxes = prediction['boxes']
            scores = prediction['scores']
            labels = prediction['labels']
            valid_detections = scores >= confidence_threshold
            
            # Speichere Ergebnisse
            result = {
                'image_idx': i,
                'image_name': dataset.annotations[i]['image'],
                'predictions': {
                    'boxes': boxes[valid_detections],
                    'scores': scores[valid_detections],
                    'labels': labels[valid_detections]
                },
                'ground_truth': {
                    'boxes': target['boxes'],
                    'labels': target['labels']
                }
            }
            results.append(result)
            
            # Berechne Metrics (einfache IoU-basierte Übereinstimmung)
            pred_boxes = boxes[valid_detections]
            gt_boxes = target['boxes']
            
            # Für jede Ground-Truth-Box
            for gt_idx, gt_box in enumerate(gt_boxes):
                matched = False
                for pred_idx, pred_box in enumerate(pred_boxes):
                    iou = calculate_iou(gt_box, pred_box)
                    if iou > 0.5:  # IoU-Schwellenwert
                        matched = True
                        metrics['true_positives'] += 1
                        break
                
                if not matched:
                    metrics['false_negatives'] += 1
            
            # Falsche Positive: Vorhersagen, die keiner Ground-Truth entsprechen
            for pred_idx, pred_box in enumerate(pred_boxes):
                matched = False
                for gt_idx, gt_box in enumerate(gt_boxes):
                    iou = calculate_iou(pred_box, gt_box)
                    if iou > 0.5:
                        matched = True
                        break
                
                if not matched:
                    metrics['false_positives'] += 1
    
    # Berechne Precision, Recall und F1-Score
    precision = metrics['true_positives'] / max(metrics['true_positives'] + metrics['false_positives'], 1)
    recall = metrics['true_positives'] / max(metrics['true_positives'] + metrics['false_negatives'], 1)
    f1_score = 2 * precision * recall / max(precision + recall, 1e-6)
    
    metrics.update({
        'precision': precision,
        'recall': recall,
        'f1_score': f1_score
    })
    
    print(f"Evaluierung abgeschlossen für {len(dataset)} Bilder")
    print(f"Metrics: Precision={precision:.4f}, Recall={recall:.4f}, F1-Score={f1_score:.4f}")
    
    return results, metrics

# Hilfsfunktion zur Berechnung von IoU (Intersection over Union)
def calculate_iou(box1, box2):
    # Box-Format: [x1, y1, x2, y2]
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    # Berechne Schnittfläche
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    
    # Berechne Flächen der Boxen
    area_box1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area_box2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    
    # Berechne Vereinigungsfläche
    union = area_box1 + area_box2 - intersection
    
    # IoU
    iou = intersection / max(union, 1e-6)
    return iou

# Beispiel für die Verwendung
if __name__ == "__main__":
    # Mehrere Annotationsdateien können verwendet werden
    annotation_files = [
        'Trainingsdaten/json/labels_25010-weierwies-5-weiningen_2025-04-20-01-08-05.json',
        'Trainingsdaten/json/combined_labels_2025-04-20-12-21-42.json'
    ]
    
    # Training
    model, train_losses, val_losses = train_model(
        image_folder='Trainingsdaten/image',
        annotation_files=annotation_files,
        num_epochs=25,  # Erhöht von 10 auf 25
        batch_size=2,
        patience=5  # Early Stopping nach 5 Epochen ohne Verbesserung
    )
    
    # Optional: Evaluierung
    test_annotation_file = 'Testdaten/annotations.json'
    if os.path.exists(test_annotation_file):
        results, metrics = evaluate_model(model, 'Testdaten/image', test_annotation_file)
        print(f"Evaluierungsergebnisse: {metrics}")
    else:
        print(f"Keine Test-Annotationsdatei gefunden unter {test_annotation_file}")