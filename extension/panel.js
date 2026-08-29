let ws = null;
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

function updateStatus(state, text) {
    statusIndicator.className = `indicator ${state}`;
    statusText.textContent = text;
}

function connectWebSocket() {
    updateStatus('connecting', 'Connecting to localhost:3000...');
    
    ws = new WebSocket('ws://localhost:3000');
    
    ws.onopen = () => {
        updateStatus('connected', 'Connected to Dashboard');
        console.log("AsyncLens: WebSocket connected.");
    };
    
    ws.onclose = () => {
        updateStatus('disconnected', 'Disconnected. Retrying in 2s...');
        ws = null;
        setTimeout(connectWebSocket, 2000);
    };
    
    ws.onerror = (err) => {
        console.error("AsyncLens WebSocket Error:", err);
    };
}

// Redact sensitive values to adhere to security rules
function redactHeaders(headers) {
    if (!headers || !Array.isArray(headers)) return [];
    
    const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'token'];
    
    return headers.map(header => {
        const nameLower = header.name.toLowerCase();
        if (sensitiveKeys.some(key => nameLower.includes(key))) {
            return { name: header.name, value: '[REDACTED]' };
        }
        return header;
    });
}

// Listen to Network Requests in DevTools
chrome.devtools.network.onRequestFinished.addListener((request) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
        const id = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        
        // Normalize the network event payload
        const networkEvent = {
            id: id,
            type: "network-request",
            timestamp: new Date(request.startedDateTime).getTime() || Date.now(),
            url: request.request.url || "Unknown URL",
            method: request.request.method || "UNKNOWN",
            resourceType: request._resourceType || "Other",
            status: request.response.status || 0,
            statusText: request.response.statusText || "",
            duration: request.time || 0,
            size: (request.response.bodySize > 0) ? request.response.bodySize : (request.response._transferSize || 0),
            initiator: request._initiator ? request._initiator.type : "unknown",
            requestHeaders: redactHeaders(request.request.headers),
            responseHeaders: redactHeaders(request.response.headers),
            timing: request.timings || {}
        };

        ws.send(JSON.stringify(networkEvent));
    } catch (e) {
        console.error("AsyncLens: Failed to process request", e);
    }
});

// Initialize connection
connectWebSocket();
