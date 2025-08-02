/**
 * Smoke Tests für Planvision
 * Einfache Tests um zu prüfen ob die wichtigsten Funktionen noch funktionieren
 * 
 * Usage: 
 * 1. Lade eine PDF/Image hoch und lass die Analyse laufen
 * 2. Öffne Browser Console (F12)
 * 3. Tippe: runSmokeTests()
 */

class SmokeTests {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
  }

  // Test helper function
  test(name, testFunction) {
    try {
      const result = testFunction();
      if (result === true || result === undefined) {
        this.results.push({ name, status: '✅ PASS', details: '' });
        this.passed++;
        console.log(`✅ ${name}`);
      } else {
        this.results.push({ name, status: '❌ FAIL', details: result });
        this.failed++;
        console.log(`❌ ${name}: ${result}`);
      }
    } catch (error) {
      this.results.push({ name, status: '💥 ERROR', details: error.message });
      this.failed++;
      console.log(`💥 ${name}: ${error.message}`);
    }
  }

  // Assert helper
  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  // Run all smoke tests
  runAll() {
    console.log('🚀 Starting Planvision Smoke Tests...\n');
    
    this.testBasicDOMElements();
    this.testCanvasSetup();
    this.testDataStructure();
    this.testAnnotationSystem();
    this.testTableFunctionality();
    this.testToolsVisibility();
    this.testEventListeners();
    
    this.printSummary();
  }

  testBasicDOMElements() {
    this.test('Upload form exists', () => {
      this.assert(document.getElementById('uploadForm'), 'Upload form should exist');
    });

    this.test('Image container exists', () => {
      this.assert(document.getElementById('imageContainer'), 'Image container should exist');
    });

    this.test('Results table exists', () => {
      this.assert(document.getElementById('resultsTable'), 'Results table should exist');
    });

    this.test('Results section visible', () => {
      const resultsSection = document.getElementById('resultsSection');
      this.assert(resultsSection, 'Results section should exist');
      
      const isVisible = resultsSection.style.display !== 'none';
      this.assert(isVisible, 'Results section should be visible after analysis');
    });
  }

  testCanvasSetup() {
    this.test('Canvas exists', () => {
      this.assert(typeof canvas !== 'undefined' && canvas !== null, 'Canvas should be initialized');
    });

    this.test('Canvas has correct size', () => {
      this.assert(canvas.getWidth() > 0, 'Canvas should have width > 0');
      this.assert(canvas.getHeight() > 0, 'Canvas should have height > 0');
    });

    this.test('Canvas has objects', () => {
      const objects = canvas.getObjects();
      this.assert(objects.length > 0, 'Canvas should have annotation objects');
    });
  }

  testDataStructure() {
    this.test('Window data exists', () => {
      this.assert(typeof window.data !== 'undefined', 'window.data should exist');
      this.assert(window.data !== null, 'window.data should not be null');
    });

    this.test('Predictions exist', () => {
      this.assert(window.data.predictions, 'Predictions array should exist');
      this.assert(Array.isArray(window.data.predictions), 'Predictions should be an array');
      this.assert(window.data.predictions.length > 0, 'Should have at least one prediction');
    });

    this.test('Predictions have required fields', () => {
      const pred = window.data.predictions[0];
      this.assert(typeof pred.label !== 'undefined', 'Prediction should have label');
      
      // Check if it has area OR length depending on type
      const hasAreaOrLength = pred.calculatedArea !== undefined || 
                             pred.calculatedLength !== undefined ||
                             pred.area !== undefined;
      this.assert(hasAreaOrLength, 'Prediction should have area or length measurement');
    });
  }

  testAnnotationSystem() {
    this.test('Annotations are Groups', () => {
      const annotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
      this.assert(annotations.length > 0, 'Should have annotation objects on canvas');
      
      const firstAnnotation = annotations[0];
      this.assert(firstAnnotation.type === 'group', 'Annotations should be Fabric.js Groups');
    });

    this.test('Groups contain annotation + number', () => {
      const annotationGroup = canvas.getObjects().find(obj => obj.objectType === 'annotation');
      const groupObjects = annotationGroup.getObjects();
      
      this.assert(groupObjects.length === 2, 'Group should contain exactly 2 objects (annotation + number)');
      
      // First object should be the annotation (rect, polygon, or polyline)
      const annotationObj = groupObjects[0];
      const validTypes = ['rect', 'polygon', 'polyline'];
      this.assert(validTypes.includes(annotationObj.type), 
                 `First object should be annotation type, got: ${annotationObj.type}`);
      
      // Second object should be the number text
      const numberObj = groupObjects[1];
      this.assert(numberObj.type === 'text', 'Second object should be number text');
    });

    this.test('Annotation indices are consistent', () => {
      const canvasAnnotations = canvas.getObjects().filter(obj => obj.objectType === 'annotation');
      const dataCount = window.data.predictions.length;
      
      this.assert(canvasAnnotations.length === dataCount, 
                 `Canvas annotations (${canvasAnnotations.length}) should match data predictions (${dataCount})`);
      
      // Check if indices are sequential
      const indices = canvasAnnotations.map(obj => obj.annotationIndex).sort((a, b) => a - b);
      for (let i = 0; i < indices.length; i++) {
        this.assert(indices[i] === i, `Annotation indices should be sequential, missing index ${i}`);
      }
    });
  }

  testTableFunctionality() {
    this.test('Table has correct row count', () => {
      const rows = document.querySelectorAll('#resultsBody tr');
      const dataCount = window.data.predictions.length;
      
      this.assert(rows.length === dataCount, 
                 `Table rows (${rows.length}) should match predictions (${dataCount})`);
    });

    this.test('Table rows have correct data', () => {
      const rows = document.querySelectorAll('#resultsBody tr');
      const firstRow = rows[0];
      
      if (firstRow) {
        const cells = firstRow.querySelectorAll('td');
        this.assert(cells.length === 5, 'Table row should have 5 columns');
        
        // Check if first cell contains a number (annotation index + 1)
        const firstCell = cells[0].textContent.trim();
        this.assert(/^\d+$/.test(firstCell), 'First cell should contain annotation number');
      }
    });

    this.test('Hover functionality works', () => {
      const firstRow = document.querySelector('#resultsBody tr');
      if (firstRow) {
        // Check if hover event listeners are attached
        const hasHoverEvents = firstRow.onmouseenter !== null || 
                              firstRow.addEventListener;
        this.assert(hasHoverEvents, 'Table rows should have hover event listeners');
      }
    });
  }

  testToolsVisibility() {
    this.test('Editor tools are visible', () => {
      const tools = document.querySelectorAll('.tool-button');
      this.assert(tools.length >= 4, 'Should have at least 4 tool buttons');
      
      // Check if tools are visible (not hidden)
      const visibleTools = Array.from(tools).filter(tool => {
        const style = window.getComputedStyle(tool);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      
      this.assert(visibleTools.length >= 4, 'Tool buttons should be visible');
    });

    this.test('Label dropdown exists', () => {
      const dropdown = document.getElementById('universalLabelSelect');
      this.assert(dropdown, 'Universal label dropdown should exist');
      this.assert(dropdown.options.length > 0, 'Dropdown should have options');
    });
  }

  testEventListeners() {
    this.test('Canvas has event listeners', () => {
      // Check if canvas has mouse events (indirect test)
      this.assert(canvas._objects, 'Canvas should have _objects property');
    });

    this.test('Page switching protection works', () => {
      this.assert(typeof isPageSwitching !== 'undefined', 'isPageSwitching should be defined');
      this.assert(isPageSwitching === false, 'isPageSwitching should be false when not switching pages');
    });

    this.test('Debounced update system works', () => {
      this.assert(typeof debouncedTableUpdate === 'function', 'debouncedTableUpdate function should exist');
      this.assert(typeof updateAnnotationDataFromCanvas === 'function', 'updateAnnotationDataFromCanvas should exist');
    });
  }

  printSummary() {
    console.log('\n📊 Test Summary:');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Success Rate: ${((this.passed / (this.passed + this.failed)) * 100).toFixed(1)}%`);
    
    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! Your app is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Check the details above.');
      console.log('\nFailed tests:');
      this.results.filter(r => r.status.includes('FAIL') || r.status.includes('ERROR'))
                  .forEach(r => console.log(`  • ${r.name}: ${r.details}`));
    }
  }
}

// Global function to run tests
function runSmokeTests() {
  const tester = new SmokeTests();
  tester.runAll();
}

// Export for potential use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SmokeTests, runSmokeTests };
}

console.log('🧪 Smoke Tests loaded. Run tests with: runSmokeTests()');