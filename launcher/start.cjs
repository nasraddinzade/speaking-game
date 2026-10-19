#!/usr/bin/env node
/**
 * Speaking Game launcher.
 *
 * 1. Serves the built game (dist/) on a local port.
 * 2. Keeps progress in data/progress.json and recordings in data/recordings/
 *    through a tiny HTTP API.
 * 3. Opens Chrome (or Edge) in app mode: a plain window, no tabs, no address bar.
 *    Google's speech engine behind the Web Speech API works in Chrome. Electron
 *    and other embedded Chromium builds answer "network"; Edge did too when tested.
 * 4. Shuts down when that window closes.
 *
 * Flags: --no-browser (serve only), --port N, --edge, --chrome, --browser "path\to\exe"
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = process.env.SPEAKING_GAME_DATA || path.join(ROOT, 'data');
const PROGRESS = path.join(DATA_DIR, 'progress.json');
const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function ensureBuild() {
  if (fs.existsSync(path.join(DIST, 'index.html'))) return;
  console.log('No build found, building the game once (vite build)...');
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 || !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('Build failed. Run "npm install" and "npm run build" first.');
    process.exit(1);
  }
}

function readBodyBuffer(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req) {
  return readBodyBuffer(req).then((b) => b.toString('utf8'));
}

const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const RECORDING_NAME = /^[A-Za-z0-9_-]+\.webm$/;

function listRecordings() {
  if (!fs.existsSync(RECORDINGS_DIR)) return { files: [], totalBytes: 0, dir: RECORDINGS_DIR };
  const files = [];
  let totalBytes = 0;
  for (const name of fs.readdirSync(RECORDINGS_DIR)) {
    if (!RECORDING_NAME.test(name)) continue;
    const st = fs.statSync(path.join(RECORDINGS_DIR, name));
    if (!st.isFile()) continue;
    files.push({ name, size: st.size, mtime: st.mtime.toISOString() });
    totalBytes += st.size;
  }
  return { files, totalBytes, dir: RECORDINGS_DIR };
}

async function handleRecordings(req, res, url) {
  const rest = url.pathname.slice('/api/recordings'.length);
  if (rest === '' || rest === '/') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(listRecordings()));
    return;
  }
  const name = decodeURIComponent(rest.slice(1));
  if (!RECORDING_NAME.test(name)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end('{"error":"bad recording name"}');
    return;
  }
  const file = path.join(RECORDINGS_DIR, name);
  if (req.method === 'HEAD' || req.method === 'GET') {
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const st = fs.statSync(file);
    res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': st.size, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return;
  }
  if (req.method === 'PUT') {
    const overwrite = url.searchParams.get('overwrite') === '1';
    const existed = fs.existsSync(file);
    if (existed && !overwrite) {
      // The first recording of a phrase is never replaced.
      const st = fs.statSync(file);
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ exists: true, mtime: st.mtime.toISOString(), size: st.size }));
      return;
    }
    const body = await readBodyBuffer(req);
    if (body.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"empty recording"}');
      return;
    }
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
    res.writeHead(existed ? 204 : 201);
    res.end();
    return;
  }
  if (req.method === 'DELETE') {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(405);
  res.end();
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ progressPath: PROGRESS, recordingsDir: RECORDINGS_DIR, version: require(path.join(ROOT, 'package.json')).version }));
    return;
  }
  if (url.pathname.startsWith('/api/recordings')) {
    await handleRecordings(req, res, url);
    return;
  }
  if (url.pathname === '/api/progress') {
    if (req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === 'GET') {
      if (!fs.existsSync(PROGRESS)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"no progress file yet"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(PROGRESS, 'utf8'));
      return;
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) throw new Error('not a progress file');
        writeAtomic(PROGRESS, JSON.stringify(parsed, null, 2));
        res.writeHead(204);
        res.end();
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
      return;
    }
  }
  res.writeHead(404);
  res.end('not found');
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        handleApi(req, res, url).catch((e) => {
          res.writeHead(500);
          res.end(String(e));
        });
        return;
      }
      serveStatic(req, res, url);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function findBrowser() {
  const custom = opt('--browser', null);
  if (custom) return { exe: custom, name: 'custom' };
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const chrome = [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
  ];
  const edge = [
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
  ];
  const order = flag('--edge') ? [...edge, ...chrome] : [...chrome, ...edge];
  if (process.platform !== 'win32') {
    const unix = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    for (const u of unix) if (fs.existsSync(u)) return { exe: u, name: path.basename(u) };
    return null;
  }
  for (const exe of order) if (fs.existsSync(exe)) return { exe, name: /msedge/i.test(exe) ? 'Edge' : 'Chrome' };
  return null;
}

async function main() {
  ensureBuild();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let port = Number(opt('--port', 7345));
  let server = null;
  for (let attempt = 0; attempt < 10 && !server; attempt++) {
    try {
      server = await startServer(port);
    } catch (e) {
      if (e.code === 'EADDRINUSE') port++;
      else throw e;
    }
  }
  if (!server) throw new Error('No free port found');
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Speaking Game is served at ${url}`);
  console.log(`Progress file: ${PROGRESS}`);

  if (flag('--no-browser')) {
    console.log('Serve-only mode. Open the URL in Chrome or Edge. Ctrl+C to stop.');
    return;
  }

  const browser = findBrowser();
  if (!browser) {
    console.log('Chrome or Edge not found. Open the URL above in Chrome or Edge yourself. Ctrl+C to stop.');
    return;
  }
  if (browser.name === 'Edge') {
    console.warn("Warning: Chrome was not found. Edge was opened instead, but on the test machine Edge's speech service answered \"network\" and recognition did not work. Install Google Chrome for a reliable microphone.");
  }
  console.log(`Opening ${browser.name}...`);
  const child = spawn(
    browser.exe,
    [
      `--app=${url}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1280,860',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
      '--autoplay-policy=no-user-gesture-required',
    ],
    { stdio: 'ignore', detached: false },
  );
  child.on('exit', () => {
    console.log('Window closed, shutting down.');
    server.close();
    process.exit(0);
  });
  child.on('error', (e) => {
    console.error('Could not start the browser:', e.message);
    console.log(`Open ${url} in Chrome or Edge yourself. Ctrl+C to stop.`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
