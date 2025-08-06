/**
 * Performance Monitor für Planvision
 * Misst kritische Performance-Metriken in Frontend und Backend
 */

class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.sessionId = Date.now().toString();
        this.measurements = [];
        this.initializePerformanceObserver();
    }

    /**
     * Starte eine neue Messung
     */
    startMeasurement(name, category = 'general') {
        const startTime = performance.now();
        const measurement = {
            name,
            category,
            startTime,
            endTime: null,
            duration: null,
            memoryBefore: this.getMemoryUsage(),
            memoryAfter: null,
            networkRequests: [],
            metadata: {}
        };
        
        this.metrics.set(name, measurement);
        console.log(`🟡 [PERF] Started: ${name} (${category})`);
        return measurement;
    }

    /**
     * Beende eine Messung
     */
    endMeasurement(name, metadata = {}) {
        const measurement = this.metrics.get(name);
        if (!measurement) {
            console.warn(`⚠️ [PERF] Measurement not found: ${name}`);
            return null;
        }

        measurement.endTime = performance.now();
        measurement.duration = measurement.endTime - measurement.startTime;
        measurement.memoryAfter = this.getMemoryUsage();
        measurement.metadata = { ...measurement.metadata, ...metadata };
        
        this.measurements.push({ ...measurement });
        
        console.log(`✅ [PERF] Completed: ${name} - ${measurement.duration.toFixed(2)}ms`, {
            duration: measurement.duration,
            memoryDelta: measurement.memoryAfter.usedJSHeapSize - measurement.memoryBefore.usedJSHeapSize,
            metadata: measurement.metadata
        });
        
        return measurement;
    }

    /**
     * Hole aktuelle Speichernutzung
     */
    getMemoryUsage() {
        if (performance.memory) {
            return {
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
            };
        }
        return { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 };
    }

    /**
     * Initialisiere Performance Observer für Navigation und Resource Timing
     */
    initializePerformanceObserver() {
        try {
            // Beobachte Netzwerk-Requests
            const networkObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.entryType === 'resource') {
                        this.recordNetworkEntry(entry);
                    } else if (entry.entryType === 'navigation') {
                        this.recordNavigationEntry(entry);
                    }
                }
            });
            
            networkObserver.observe({ entryTypes: ['resource', 'navigation'] });
            
        } catch (e) {
            console.warn('⚠️ [PERF] Performance Observer not supported:', e);
        }
    }

    /**
     * Zeichne Netzwerk-Request auf
     */
    recordNetworkEntry(entry) {
        const networkData = {
            name: entry.name,
            duration: entry.duration,
            transferSize: entry.transferSize || 0,
            encodedBodySize: entry.encodedBodySize || 0,
            decodedBodySize: entry.decodedBodySize || 0,
            initiatorType: entry.initiatorType,
            nextHopProtocol: entry.nextHopProtocol,
            timing: {
                dns: entry.domainLookupEnd - entry.domainLookupStart,
                tcp: entry.connectEnd - entry.connectStart,
                request: entry.responseStart - entry.requestStart,
                response: entry.responseEnd - entry.responseStart,
                total: entry.responseEnd - entry.requestStart
            }
        };
        
        // Zuordnung zu laufenden Messungen
        this.metrics.forEach(measurement => {
            if (measurement.endTime === null) {
                measurement.networkRequests.push(networkData);
            }
        });
    }

    /**
     * Zeichne Navigation-Timing auf
     */
    recordNavigationEntry(entry) {
        console.log('🌐 [PERF] Navigation Timing:', {
            domContentLoaded: entry.domContentLoadedEventEnd - entry.domContentLoadedEventStart,
            loadComplete: entry.loadEventEnd - entry.loadEventStart,
            totalLoad: entry.loadEventEnd - entry.fetchStart
        });
    }

    /**
     * Messe spezifische Planvision-Operationen
     */
    measureCanvasOperation(operationName, operation) {
        this.startMeasurement(`canvas-${operationName}`, 'canvas');
        
        const result = operation();
        
        // Wenn es ein Promise ist, warten wir darauf
        if (result && typeof result.then === 'function') {
            return result.then((res) => {
                this.endMeasurement(`canvas-${operationName}`);
                return res;
            });
        } else {
            this.endMeasurement(`canvas-${operationName}`);
            return result;
        }
    }

    /**
     * Messe API-Calls
     */
    async measureApiCall(url, options = {}) {
        const measurementName = `api-${url.split('/').pop()}`;
        this.startMeasurement(measurementName, 'api');
        
        try {
            const response = await fetch(url, options);
            const responseData = await response.json();
            
            this.endMeasurement(measurementName, {
                url,
                status: response.status,
                responseSize: JSON.stringify(responseData).length,
                success: response.ok
            });
            
            return responseData;
        } catch (error) {
            this.endMeasurement(measurementName, {
                url,
                error: error.message,
                success: false
            });
            throw error;
        }
    }

    /**
     * Generiere Performance-Report
     */
    generateReport() {
        const report = {
            sessionId: this.sessionId,
            timestamp: new Date().toISOString(),
            measurements: this.measurements,
            summary: this.generateSummary(),
            systemInfo: this.getSystemInfo()
        };
        
        console.log('📊 [PERF] Performance Report:', report);
        return report;
    }

    /**
     * Generiere Zusammenfassung
     */
    generateSummary() {
        const categories = {};
        
        this.measurements.forEach(measurement => {
            if (!categories[measurement.category]) {
                categories[measurement.category] = {
                    count: 0,
                    totalDuration: 0,
                    avgDuration: 0,
                    minDuration: Infinity,
                    maxDuration: 0
                };
            }
            
            const cat = categories[measurement.category];
            cat.count++;
            cat.totalDuration += measurement.duration;
            cat.minDuration = Math.min(cat.minDuration, measurement.duration);
            cat.maxDuration = Math.max(cat.maxDuration, measurement.duration);
        });
        
        // Durchschnitt berechnen
        Object.values(categories).forEach(cat => {
            cat.avgDuration = cat.totalDuration / cat.count;
            if (cat.minDuration === Infinity) cat.minDuration = 0;
        });
        
        return categories;
    }

    /**
     * System-Informationen sammeln
     */
    getSystemInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            connection: navigator.connection ? {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt
            } : null,
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth
            }
        };
    }

    /**
     * Exportiere Daten als JSON
     */
    exportData() {
        const report = this.generateReport();
        const blob = new Blob([JSON.stringify(report, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `planvision-performance-${this.sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Zeige Performance-Dashboard
     */
    showDashboard() {
        const report = this.generateReport();
        const dashboard = this.createDashboardHTML(report);
        
        // Öffne in neuem Fenster
        const newWindow = window.open('', '_blank', 'width=1200,height=800');
        newWindow.document.write(dashboard);
        newWindow.document.close();
    }

    /**
     * Erstelle Dashboard HTML
     */
    createDashboardHTML(report) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Planvision Performance Dashboard</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 1200px; margin: 0 auto; }
                .card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .metric { display: inline-block; margin: 10px; padding: 15px; background: #e3f2fd; border-radius: 4px; }
                .metric-value { font-size: 24px; font-weight: bold; color: #1976d2; }
                .metric-label { font-size: 12px; color: #666; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
                .slow { background-color: #ffebee; }
                .medium { background-color: #fff3e0; }
                .fast { background-color: #e8f5e8; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 Planvision Performance Dashboard</h1>
                <p>Session: ${report.sessionId} | ${report.timestamp}</p>
                
                <div class="card">
                    <h2>📊 Zusammenfassung</h2>
                    ${Object.entries(report.summary).map(([category, stats]) => `
                        <div class="metric">
                            <div class="metric-value">${stats.avgDuration.toFixed(2)}ms</div>
                            <div class="metric-label">${category} (Ø)</div>
                        </div>
                        <div class="metric">
                            <div class="metric-value">${stats.count}</div>
                            <div class="metric-label">${category} calls</div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="card">
                    <h2>⏱️ Detaillierte Messungen</h2>
                    <table>
                        <tr>
                            <th>Operation</th>
                            <th>Kategorie</th>
                            <th>Dauer (ms)</th>
                            <th>Speicher (MB)</th>
                            <th>Netzwerk</th>
                        </tr>
                        ${report.measurements.map(m => {
                            const rowClass = m.duration > 1000 ? 'slow' : m.duration > 500 ? 'medium' : 'fast';
                            const memoryDelta = ((m.memoryAfter.usedJSHeapSize - m.memoryBefore.usedJSHeapSize) / 1024 / 1024).toFixed(2);
                            return `
                                <tr class="${rowClass}">
                                    <td>${m.name}</td>
                                    <td>${m.category}</td>
                                    <td>${m.duration.toFixed(2)}</td>
                                    <td>${memoryDelta}</td>
                                    <td>${m.networkRequests.length} requests</td>
                                </tr>
                            `;
                        }).join('')}
                    </table>
                </div>
                
                <div class="card">
                    <h2>💻 System-Info</h2>
                    <pre>${JSON.stringify(report.systemInfo, null, 2)}</pre>
                </div>
            </div>
        </body>
        </html>
        `;
    }
}

// Globale Instanz erstellen
window.perfMonitor = new PerformanceMonitor();

// Hilfsfunktionen für einfache Nutzung
window.startPerfMeasurement = (name, category) => window.perfMonitor.startMeasurement(name, category);
window.endPerfMeasurement = (name, metadata) => window.perfMonitor.endMeasurement(name, metadata);
window.showPerfDashboard = () => window.perfMonitor.showDashboard();
window.exportPerfData = () => window.perfMonitor.exportData();

console.log('🚀 Performance Monitor initialized');