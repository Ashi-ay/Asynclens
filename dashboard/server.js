const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve the index.html file you already created
app.use(express.static(path.join(__dirname)));

// WebSocket Broadcast Hub
wss.on('connection', (ws) => {
    console.log('[Server] New WebSocket connection established.');

    ws.on('message', (message) => {
        // Broadcast incoming messages (from the extension) to all other clients (the dashboard UI)
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === ws.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log('[Server] Client disconnected.');
    });
});

server.listen(PORT, () => {
    console.log(`[AsyncLens] Dashboard running at http://localhost:${PORT}`);
});