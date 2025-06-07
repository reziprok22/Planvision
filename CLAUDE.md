# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planvision is a Flask-based web application for architectural plan analysis that uses computer vision to detect and annotate building elements (windows, doors, walls, roofs, etc.) in PDF and image files. The application provides:

- AI-powered object detection using a Faster R-CNN model
- Multi-page PDF support with individual page analysis
- Interactive annotation editor using Fabric.js
- Project management with save/load functionality
- PDF report generation with bounding box overlays

## Development Commands

### Running the Application
```bash
# Start the Flask development server
python app.py
```

### Python Environment
The project uses a virtual environment located at `env/` with dependencies listed in `requirements.txt`. Key dependencies include:
- Flask 3.1.0 for web framework
- PyTorch 2.6.0 for machine learning
- OpenCV for image processing
- Fabric.js (CDN) for canvas interactions

### Model Requirements
The application requires a pre-trained Faster R-CNN model at:
`fasterrcnn_model/fasterrcnn_model_2025-04-22-20-04-25.pth`

## Architecture

### Backend (Python)
- **app.py**: Main Flask application with route handlers for file upload, prediction, PDF processing, and project management
- **model_handler.py**: PyTorch model loading and inference logic
- **pdf_export.py**: PDF report generation using ReportLab and PyMuPDF
- **image_preprocessing.py**: OpenCV-based image preprocessing
- **utils.py**: Scale calculations and non-maximum suppression utilities

### Frontend (JavaScript ES6 Modules)
- **main.js**: Primary application controller, coordinates all modules and handles form submission
- **fabric-handler.js**: Fabric.js canvas management for interactive annotations
- **zoom-manager.js**: Image zoom and pan functionality
- **pdf-handler.js**: Multi-page PDF navigation and state management
- **project.js**: Project save/load operations
- **labels.js**: Label management system for object categories

### Data Flow
1. User uploads PDF/image via HTML form
2. `app.py` converts PDF to images if needed, extracts page dimensions
3. `model_handler.py` runs AI inference using the Faster R-CNN model
4. Results return to frontend with bounding boxes and confidence scores
5. `fabric-handler.js` renders annotations on Fabric.js canvas overlay
6. User can edit annotations in editor mode
7. Projects can be saved with all page data and exported as PDF reports

### File Structure Patterns
- `static/uploads/`: Temporary session directories for converted PDF images
- `projects/`: Saved project data with subdirectories per project ID
- `static/reports/`: Generated PDF reports
- `templates/`: Single HTML template file

## Key Technical Details

### PDF Processing
- PDFs are converted to JPG images using pdf2image
- Page dimensions are extracted using PyPDF2 for accurate scaling
- Each PDF session gets a unique directory under `static/uploads/`

### Object Detection Model
- Uses torchvision's Faster R-CNN with ResNet-50 backbone
- 6 classes: Background, Window, Door, Wall, Dormer, Roof
- Applies NMS (Non-Maximum Suppression) to filter overlapping detections
- Calculates real-world areas using DPI and scale factor

### Annotation System
- Fabric.js canvas overlays the image for interactive editing
- Supports rectangles, polygons, and line measurements
- Canvas coordinates are synchronized with image zoom levels
- Editor mode allows adding, editing, and deleting annotations

### Project Data Format
Projects store JSON files containing:
- `metadata.json`: Project info and creation date
- `analysis/page_X_results.json`: Per-page detection results
- `analysis/analysis_settings.json`: Analysis parameters
- `analysis/labels.json`: Custom label definitions
- `pages/`: Original image files
- `original.pdf`: Original PDF file if applicable

## Common Development Tasks

When adding new object detection classes, update:
1. Model training pipeline and class count in `model_handler.py`
2. Label definitions in `static/js/labels.js`
3. Color mappings and UI elements in HTML template

When modifying the annotation editor:
1. Update `fabric-handler.js` for canvas interactions
2. Coordinate changes with `main.js` for state management
3. Test zoom synchronization between image and canvas

When changing PDF processing:
1. Update `app.py` route handlers for new parameters
2. Ensure `pdf-handler.js` manages navigation state correctly
3. Verify export functions in `pdf_export.py` handle new data formats