let dashboardSocket = null;
let isConnected = false;

function connectWebSocket() {
    dashboardSocket = new WebSocket('ws://localhost:3000');

    dashboardSocket.onopen = () => {
        console.log("[AsyncLens Background] Connected to dashboard server.");
        isConnected = true;
    };

    dashboardSocket.onerror = (error) => {
        isConnected = false;
    };

    dashboardSocket.onclose = () => {
        isConnected = false;
        // Attempt to auto-reconnect if the server is restarted
        setTimeout(connectWebSocket, 3000);
    };
}

// Initialize connection
connectWebSocket();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Answer status pings from panel.js
    if (message.type === "GET_STATUS") {
        sendResponse({ status: isConnected ? "connected" : "disconnected" });
    } 
    // Forward network payloads to the dashboard
    else if (message.type === "NETWORK_REQUEST") {
        if (dashboardSocket && dashboardSocket.readyState === WebSocket.OPEN) {
            dashboardSocket.send(JSON.stringify(message.data));
        }
    }
    return true; 
});