const WebSocket = require('ws');

// REPLACE THIS WITH YOUR RENDER URL! 
// Example: 'wss://scavenger-brain-xyz.onrender.com'
const WEBSOCKET_URL = 'wss://scavenger-brain.onrender.com'; 

function connect() {
    console.log('Attempting to connect to Brain...');
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on('open', () => {
        console.log('Connected! Reporting for duty.');
        // Tell the brain we are a worker
        ws.send(JSON.stringify({ type: 'REGISTER_WORKER' }));
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'NEW_TASK') {
                console.log(`Received Task ${message.taskId}: ${message.payload}`);
                performTask(ws, message.taskId);
            }
        } catch(e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Disconnected. Retrying in 5 seconds...');
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
        console.error('Socket error:', err.message);
        ws.close();
    });
}

function performTask(ws, taskId) {
    // SIMULATE HEAVY WORK
    // In reality, this is where we crack passwords or mine hash
    console.log('Crunching numbers...');
    
    // Simulate 2 seconds of work
    setTimeout(() => {
        const result = `Processed_${taskId}_by_GitHub`;
        
        ws.send(JSON.stringify({
            type: 'TASK_COMPLETE',
            taskId: taskId,
            result: result
        }));
        console.log('Task finished and sent.');
    }, 2000); 
}

// Start the engine
connect();
