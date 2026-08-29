let ws = null;

function connectWebSocket() {
    ws = new WebSocket('ws://localhost:3000');

    ws.onopen = () => {
        console.log("AsyncLens: Background WebSocket connected.");
        chrome.runtime.sendMessage({ type: "WS_STATUS", status: "connected" }).catch(() => {});
    };

    ws.onclose = () => {
        console.log("AsyncLens: Background WebSocket disconnected.");
        chrome.runtime.sendMessage({ type: "WS_STATUS", status: "disconnected" }).catch(() => {});
        ws = null;
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
        console.error("AsyncLens WebSocket Error:", err);
    };
}

// Receive captured network payloads from DevTools panel and relay over WebSocket
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
        const isConnected = ws && ws.readyState === WebSocket.OPEN;
        sendResponse({ status: isConnected ? "connected" : "disconnected" });
        return true;
    }

    if (message.type === "NETWORK_REQUEST") {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message.data));
        }
    }
});

connectWebSocket();