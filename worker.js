const WebSocket = require('ws');
const crypto = require('crypto');

// REPLACE WITH YOUR URL!
const WEBSOCKET_URL = 'wss://scavenger-brain.onrender.com'; 

function connect() {
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on('open', () => ws.send(JSON.stringify({ type: 'REGISTER_WORKER' })));

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'MINING_JOB') {
            mine(ws, msg.start, msg.end, msg.target);
        } else if (msg.type === 'STOP') {
            console.log("!!! SYSTEM HALT. TICKET FOUND: " + msg.solution);
            ws.close();
            process.exit(0);
        }
    });

    ws.on('close', () => setTimeout(connect, 5000));
    ws.on('error', () => ws.close());
}

function mine(ws, start, end, targetPrefix) {
    console.log(`Mining range: ${start} - ${end}`);
    
    // THE HEAVY LOOP
    for (let i = start; i < end; i++) {
        // We are hashing the string "scavenger" + number
        const input = "scavenger" + i; 
        const hash = crypto.createHash('sha256').update(input).digest('hex');

        if (hash.startsWith(targetPrefix)) {
            console.log("FOUND IT! " + input);
            ws.send(JSON.stringify({
                type: 'JOB_COMPLETE',
                solution: input, 
                hash: hash
            }));
            return;
        }
    }

    // Finished range, nothing found
    ws.send(JSON.stringify({ type: 'JOB_COMPLETE', solution: null }));
}

connect();
