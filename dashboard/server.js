const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3000;

// Simple static file server
const server = http.createServer((req, res) => {
    // Serve index.html for root or matching paths
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading dashboard');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// WebSocket Server attached to HTTP Server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New WebSocket client connected.');

    ws.on('message', (message) => {
        // Broadcast incoming events (from extension) to all connected dashboards
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
    });
});

server.listen(PORT, () => {
    console.log(`AsyncLens Dashboard running at http://localhost:${PORT}`);
    console.log(`Waiting for extension connection...`);
});
