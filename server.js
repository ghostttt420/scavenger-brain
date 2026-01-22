const express = require('express');
const { Server } = require('ws');
const http = require('http');
const cors = require('cors');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;

// --- STATE (The Brain's Memory) ---
// In a real app, this would be a database. For now, RAM is fine.
let tasks = []; 
let results = [];
let workers = new Set(); // Active Muscle (GitHub/Termux)
let clients = new Set(); // Active Dashboards (You watching)

// Generate dummy "Big Tasks" (e.g., numbers to check)
// In reality, this could be millions of password hashes.
for (let i = 0; i < 1000; i++) {
    tasks.push({ id: i, payload: `Chunk_${i}`, status: 'PENDING' });
}

// --- SERVER SETUP ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new Server({ server });

// --- HTTP ENDPOINTS (For Vercel/Flash Mobs) ---
app.get('/', (req, res) => {
    res.send(`Scavenger Brain Online. Tasks Remaining: ${tasks.length}. Workers: ${workers.size}`);
});

// --- WEBSOCKET LOGIC (For GitHub Muscle & Real-time Dashboard) ---
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
        broadcastStats(); // Update dashboard
    });
});

// --- THE CORE LOGIC ---
function handleMessage(ws, data) {
    switch (data.type) {
        
        // 1. A Worker (GitHub/Termux) joins and asks for work
        case 'REGISTER_WORKER':
            workers.add(ws);
            console.log('Worker joined!');
            sendTask(ws);
            broadcastStats();
            break;

        // 2. A Dashboard (You) joins to watch
        case 'REGISTER_CLIENT':
            clients.add(ws);
            ws.send(JSON.stringify({ type: 'STATS', tasksLeft: tasks.length, workers: workers.size, resultsCount: results.length }));
            break;

        // 3. Worker finished a job!
        case 'TASK_COMPLETE':
            console.log(`Task ${data.taskId} complete! Result: ${data.result}`);
            results.push(data.result);
            
            // Give the worker a new task immediately
            sendTask(ws);
            broadcastStats();
            break;
    }
}

function sendTask(ws) {
    // Find a pending task
    const task = tasks.find(t => t.status === 'PENDING');
    
    if (task) {
        task.status = 'ASSIGNED'; // Lock it so others don't take it
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

