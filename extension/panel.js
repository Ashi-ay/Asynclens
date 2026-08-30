function updateStatus(state, text) {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    if (statusIndicator) statusIndicator.className = `indicator ${state}`;
    if (statusText) statusText.textContent = text;
}

// Keep UI updated with background WebSocket status
setInterval(() => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError) return; 
        if (response && response.status === "connected") {
            updateStatus('connected', 'Connected to Dashboard Server');
        } else {
            updateStatus('disconnected', 'Disconnected. Is server.js running?');
        }
    });
}, 2000);

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

// Hook into Chrome's DevTools Network stream
chrome.devtools.network.onRequestFinished.addListener((request) => {
    try {
        const networkEvent = {
            id: Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
            type: "network-request",
            timestamp: new Date(request.startedDateTime).getTime() || Date.now(),
            url: request.request.url || "Unknown URL",
            method: request.request.method || "UNKNOWN",
            resourceType: request._resourceType || "Other",
            status: request.response.status || 0,
            statusText: request.response.statusText || "",
            duration: request.time || 0,
            responseLength: (request.response.bodySize > 0) ? request.response.bodySize : (request.response._transferSize || 0),
            requestHeaders: redactHeaders(request.request.headers),
            responseHeaders: redactHeaders(request.response.headers),
            
            // --- NEW ENRICHMENT FIELDS ---
            timings: request.timings || {},
            initiator: request._initiator || null,
            serverIPAddress: request.serverIPAddress || "",
            connectionId: request.connection || "",
            redirectURL: (request.response && request.response.redirectURL) || ""
        };

        // Send mapped payload to the background script for WebSocket transmission
        chrome.runtime.sendMessage({ 
            type: "NETWORK_REQUEST", 
            data: networkEvent 
        });
        
    } catch (e) {
        console.error("AsyncLens: Failed to process request", e);
    }
});