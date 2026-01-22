const express = require('express');
const { Server } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path'); // <--- THIS WAS MISSING!

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;

// --- STATE (The Brain's Memory) ---
let tasks = []; 
let results = [];
let workers = new Set(); // Active Muscle (GitHub/Termux)
let clients = new Set(); // Active Dashboards (You watching)

// Generate dummy "Big Tasks" 
for (let i = 0; i < 1000; i++) {
    tasks.push({ id: i, payload: `Chunk_${i}`, status: 'PENDING' });
}

// --- SERVER SETUP ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new Server({ server });

// --- HTTP ENDPOINTS ---
// Serve the Dashboard HTML
app.get('/', (req, res) => {
    // This requires the 'path' module we imported at the top
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- WEBSOCKET LOGIC ---
wss.on('connection', (ws) => {
    console.log('New connection established');

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
        console.log('Connection closed');
        broadcastStats(); 
    });
});

// --- THE CORE LOGIC ---
function handleMessage(ws, data) {
    switch (data.type) {

        case 'REGISTER_WORKER':
            workers.add(ws);
            console.log('Worker joined!');
            sendTask(ws);
            broadcastStats();
            break;

        case 'REGISTER_CLIENT':
            clients.add(ws);
            // FIXED: Calculate *pending* tasks so dashboard shows correct progress immediately
            const pendingCount = tasks.filter(t => t.status === 'PENDING').length;
            ws.send(JSON.stringify({ 
                type: 'STATS', 
                tasksLeft: pendingCount, 
                workers: workers.size, 
                resultsCount: results.length 
            }));
            break;

        case 'TASK_COMPLETE':
            console.log(`Task ${data.taskId} complete! Result: ${data.result}`);
            results.push(data.result);
            sendTask(ws);
            broadcastStats();
            break;
    }
}

function sendTask(ws) {
    const task = tasks.find(t => t.status === 'PENDING');

    if (task) {
        task.status = 'ASSIGNED'; 
        ws.send(JSON.stringify({
            type: 'NEW_TASK',
            taskId: task.id,
            payload: task.payload
        }));
    } else {
        ws.send(JSON.stringify({ type: 'NO_WORK' }));
    }
}

function broadcastStats() {
    const stats = JSON.stringify({
        type: 'STATS',
        tasksLeft: tasks.filter(t => t.status === 'PENDING').length,
        workers: workers.size,
        resultsCount: results.length
    });

    clients.forEach(client => client.send(stats));
}

// --- START THE ENGINE ---
server.listen(PORT, () => {
    console.log(`Brain listening on port ${PORT}`);
});
