// Test script for Fabric.js integration
// Save this as a separate file or add to your project as needed

/**
 * Test Fabric.js implementation with various shapes
 */
function testFabricImplementation() {
    console.log("Running Fabric.js integration test...");
    
    // Get canvas reference
    const canvas = FabricHandler.getCanvas();
    if (!canvas) {
      console.error("Fabric.js canvas not initialized!");
      return false;
    }
    
    // Clear canvas
    canvas.clear();
    
    try {
      // Test 1: Create a rectangle
      const rect = new fabric.Rect({
        left: 50,
        top: 50,
        width: 100,
        height: 80,
        fill: 'rgba(0, 0, 255, 0.2)',
        stroke: 'blue',
        strokeWidth: 2,
        objectType: 'annotation',
        annotationType: 'rectangle',
        labelId: 1,
        labelName: 'Fenster',
        annotationIndex: 0
      });
      canvas.add(rect);
      console.log("Rectangle added successfully");
      
      // Test 2: Create a polygon
      const polygon = new fabric.Polygon([
        { x: 200, y: 50 },
        { x: 250, y: 100 },
        { x: 200, y: 150 },
        { x: 150, y: 100 }
      ], {
        fill: 'rgba(255, 0, 0, 0.2)',
        stroke: 'red',
        strokeWidth: 2,
        objectType: 'annotation',
        annotationType: 'polygon',
        labelId: 2,
        labelName: 'Tür',
        annotationIndex: 1
      });
      canvas.add(polygon);
      console.log("Polygon added successfully");
      
      // Test 3: Create a line
      const line = new fabric.Polyline([
        { x: 300, y: 50 },
        { x: 400, y: 150 }
      ], {
        fill: '',
        stroke: 'orange',
        strokeWidth: 2,
        objectType: 'annotation',
        annotationType: 'line',
        length: 1.5,
        annotationIndex: 2
      });
      canvas.add(line);
      console.log("Line added successfully");
      
      // Add text labels
      const rectLabel = new fabric.Text("#1: 0.80 m²", {
        left: 50,
        top: 30,
        fontSize: 12,
        fill: 'white',
        backgroundColor: 'blue',
        padding: 5,
        objectType: 'label',
        annotationIndex: 0
      });
      
      const polygonLabel = new fabric.Text("#2: 0.50 m²", {
        left: 200,
        top: 30,
        fontSize: 12,
        fill: 'white',
        backgroundColor: 'red',
        padding: 5,
        objectType: 'label',
        annotationIndex: 1
      });
      
      const lineLabel = new fabric.Text("#3: 1.50 m", {
        left: 400,
        top: 150,
        fontSize: 12,
        fill: 'orange',
        objectType: 'label',
        annotationIndex: 2
      });
      
      canvas.add(rectLabel);
      canvas.add(polygonLabel);
      canvas.add(lineLabel);
      
      // Test 4: Zooming
      canvas.setZoom(1.2);
      console.log("Zoom test successful");
      
      // Test 5: Reset zoom
      setTimeout(() => {
        canvas.setZoom(1);
        console.log("Reset zoom successful");
      }, 1000);
      
      // Render canvas
      canvas.renderAll();
      
      console.log("All Fabric.js tests completed successfully!");
      return true;
    } catch (error) {
      console.error("Error in Fabric.js test:", error);
      return false;
    }
  }
  
  /**
   * Run this test after the page loads and an image is displayed
   * You can call this function from the browser console with:
   * testFabricImplementation()
   */
  window.testFabricImplementation = testFabricImplementation;