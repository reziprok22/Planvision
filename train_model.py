import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from PIL import Image
import json
import datetime

# Aktuelles Datum und Zeit für den Dateinamen
timestamp = datetime.datetime.now().strftime("%Y-%m-%d-%H-%M-%S")

# Dataset-Klasse
class WindowDataset(Dataset):
    def __init__(self, image_folder, annotation_file, transform=None):
        with open(annotation_file, 'r') as f:
            self.annotations = json.load(f)
        self.image_folder = image_folder
        self.transform = transform

    def __len__(self):
        return len(self.annotations)

    def __getitem__(self, idx):
        annotation = self.annotations[idx]
        image = Image.open(f"{self.image_folder}/{annotation['image']}")
        
        # Bounding Boxen und Labels als Tensoren
        boxes = torch.tensor([anno['bbox'] for anno in annotation['annotations']], dtype=torch.float32)
        labels = torch.tensor([anno['category_id'] for anno in annotation['annotations']], dtype=torch.int64)
        
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

# Hauptfunktion für das Training
def train_model(image_folder, annotation_file, num_epochs=10, batch_size=4, output_path=f"fasterrcnn_model/fasterrcnn_model_{timestamp}.pth"):
    # Transformationen
    transform = transforms.Compose([transforms.ToTensor()])
    
    # Dataset und DataLoader einrichten
    dataset = WindowDataset(image_folder, annotation_file, transform)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True, 
                           collate_fn=lambda batch: tuple(zip(*batch)))
    
    # Modell, Gerät und Optimizer einrichten
    device = torch.device('cuda') if torch.cuda.is_available() else torch.device('cpu')
    model = get_model()
    model.to(device)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.005, momentum=0.9, weight_decay=0.0005)
    
    # Training
    for epoch in range(num_epochs):
        model.train()
        epoch_loss = 0
        for images, targets in dataloader:
            images = list(image.to(device) for image in images)
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            
            loss_dict = model(images, targets)
            losses = sum(loss for loss in loss_dict.values())
            epoch_loss += losses.item()
            
            optimizer.zero_grad()
            losses.backward()
            optimizer.step()
        
        print(f"Epoch #{epoch} Loss: {epoch_loss / len(dataloader)}")
    
    # Modell speichern
    torch.save(model.state_dict(), output_path)
    print(f"Modell gespeichert unter {output_path}")

if __name__ == "__main__":
    # Hier kannst du Kommandozeilenargumente verarbeiten oder feste Werte verwenden
    train_model(
        image_folder='Trainingsdaten/image',
        annotation_file='/home/fabian/Documents Bauphysik Lengg/10000 Admin/055 Website/Planvision/Trainingsdaten/json/combined_labels_2025-04-20-18-37-53.json'
    )