from flask import Flask, render_template, request, jsonify
import os
from model_handler import load_model, predict_image

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        # Parameter aus der Anfrage lesen
        format_size = (
            float(request.form.get('format_width', 210)),  # Standard: A4 Breite in mm
            float(request.form.get('format_height', 297))  # Standard: A4 Höhe in mm
        )
        dpi = float(request.form.get('dpi', 300))  # Standard: 300 DPI
        plan_scale = float(request.form.get('plan_scale', 100))  # Standard: 1:100
        threshold = float(request.form.get('threshold', 0.5))  # Standard: 0.5
        
        if file:
            image_bytes = file.read()
            boxes, labels, scores, areas = predict_image(
                image_bytes, 
                format_size=format_size, 
                dpi=dpi, 
                plan_scale=plan_scale, 
                threshold=threshold
            )
            
            results = []
            for box, label, score, area in zip(boxes, labels, scores, areas):
                results.append({
                    'box': box.tolist(),
                    'label': int(label),
                    'score': round(float(score), 2),
                    'area': round(float(area), 2)
                })
            
            # Gesamtfläche berechnen
            total_area = sum(area for area in areas)
            
            return jsonify({
                'predictions': results,
                'total_area': round(float(total_area), 2),
                'count': len(results)
            })
        
        return jsonify({'error': 'Error processing file'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Versuche, das Modell zu Beginn zu laden
    try:
        load_model()
        app.run(debug=True)
    except Exception as e:
        print(f"Error loading model: {e}")