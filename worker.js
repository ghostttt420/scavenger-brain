const WebSocket = require('ws');
const crypto = require('crypto');

// REPLACE WITH YOUR RENDER URL!
const WEBSOCKET_URL = 'wss://scavenger-brain.onrender.com'; 

function connect() {
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on('open', () => ws.send(JSON.stringify({ type: 'REGISTER_WORKER' })));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            // 1. CRACKING JOB (MD5)
            if (msg.type === 'MINING_JOB') {
                crack(ws, msg.start, msg.end, msg.target);
            } 
            // 2. STOP COMMAND
            else if (msg.type === 'STOP') {
                console.log("!!! SYSTEM HALT. PASSWORD FOUND: " + msg.solution);
                ws.close();
                process.exit(0);
            }
            // 3. PROXY MODE (The Hydra Feature)
            else if (msg.type === 'HTTP_PROXY') {
                console.log(`Proxying request to: ${msg.url}`);

                fetch(msg.url)
                    .then(async (response) => {
                        const text = await response.text();
                        ws.send(JSON.stringify({
                            type: 'PROXY_RESULT',
                            requestId: msg.requestId,
                            status: response.status,
                            body: text.substring(0, 500) + "..." // Truncate
                        }));
                    })
                    .catch(err => {
                        ws.send(JSON.stringify({
                            type: 'PROXY_RESULT',
                            requestId: msg.requestId,
                            error: err.message
                        }));
                    });
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    ws.on('close', () => setTimeout(connect, 5000));
    ws.on('error', () => ws.close());
}

// --- THE NEW MD5 CRACKER LOGIC ---
function crack(ws, start, end, targetHash) {
    console.log(`[CRACKER] Brute-forcing range: ${start} - ${end}`);

    for (let i = start; i < end; i++) {
        // 1. Generate the guess (Assuming numeric PIN for this demo)
        // In a real attack, you'd iterate "aaaa", "aaab", etc.
        const guess = i.toString(); 
        
        // 2. Hash the guess using MD5
        const hash = crypto.createHash('md5').update(guess).digest('hex');

        // 3. Compare with the Target
        if (hash === targetHash) {
            console.log("!!! PASSWORD CRACKED: " + guess);
            ws.send(JSON.stringify({
                type: 'JOB_COMPLETE',
                solution: guess, 
                hash: hash
            }));
            return;
        }
    }

    // Nothing found in this range
    ws.send(JSON.stringify({ type: 'JOB_COMPLETE', solution: null }));
}

connect();
