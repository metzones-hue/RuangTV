'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const { WebSocketServer } = require('ws');

// ── CONFIG ───────────────────────────────────────────────────────────────────
const PORT    = parseInt(process.env.PORT  || '3000', 10);
const HOST    = process.env.HOST           || '0.0.0.0';
const ENV     = process.env.NODE_ENV       || 'development';
const isDev   = ENV === 'development';

const RATE_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_MAX    = parseInt(process.env.RATE_LIMIT_MAX       || '120',   10);

// ── APP ──────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── SECURITY HEADERS (Helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],          // player & dashboard butuh inline JS
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'", 'ws:', 'wss:'],
      mediaSrc:    ["'self'", 'blob:'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: isDev ? null : [],
    },
  },
  crossOriginEmbedderPolicy: false,   // diperlukan agar video blob: bisa diputar
  hsts: isDev ? false : {             // HTTPS-only di production
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// ── REQUEST LOGGER ───────────────────────────────────────────────────────────
const logFormat = process.env.LOG_FORMAT || (isDev ? 'dev' : 'combined');
app.use(morgan(logFormat));

// ── RATE LIMITING ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: RATE_WINDOW,
  max:      RATE_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Terlalu banyak request. Coba lagi sebentar.' },
  skip: (req) => {
    // Jangan rate-limit WebSocket upgrade & file statis
    return req.headers.upgrade === 'websocket' || req.url.startsWith('/content/');
  },
});
app.use('/api', limiter);

// ── BODY PARSER ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// ── STATIC FILES ─────────────────────────────────────────────────────────────
const PUBLIC_DIR  = path.join(__dirname, 'public');
const CONTENT_DIR = path.resolve(process.env.CONTENT_DIR || './content');

app.use(express.static(PUBLIC_DIR, {
  maxAge: isDev ? 0 : '1h',
  etag:   true,
}));
app.use('/content', express.static(CONTENT_DIR, {
  maxAge: isDev ? 0 : '7d',
}));

// ── IN-MEMORY STORE (ganti dengan DB di production) ──────────────────────────
const store = {
  branches: {
    DMB: { name: 'Ruangprint DMB', status: 'online',  currentContent: 'promo-lebaran' },
    CTR: { name: 'Ruangprint CTR', status: 'online',  currentContent: 'diskon-member' },
    GDS: { name: 'Ruangprint GDS', status: 'online',  currentContent: 'info-layanan' },
    CGK: { name: 'Ruangprint CGK', status: 'online',  currentContent: 'menu-print'   },
    BKS: { name: 'Ruangprint BKS', status: 'offline', currentContent: null           },
  },
  contents: [],
};

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    env:       ENV,
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
    clients:   wss.clients.size,
  });
});

app.get('/api/branches', (_req, res) => res.json(store.branches));

app.get('/api/branches/:code', (req, res) => {
  const branch = store.branches[req.params.code.toUpperCase()];
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan.' });
  res.json(branch);
});

app.get('/api/contents', (_req, res) => res.json(store.contents));

// Broadcast konten ke semua player (atau ke branch tertentu via query ?branch=DMB)
app.post('/api/broadcast', (req, res) => {
  const { contentId, branches, message } = req.body;
  if (!contentId && !message) {
    return res.status(400).json({ error: 'contentId atau message diperlukan.' });
  }

  const payload = JSON.stringify({
    type:      'broadcast',
    contentId: contentId || null,
    branches:  branches  || null,   // null = semua cabang
    message:   message   || null,
    ts:        Date.now(),
  });

  let sent = 0;
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
      sent++;
    }
  });

  res.json({ ok: true, clientsNotified: sent });
});

// ── 404 HANDLER ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// ── ERROR HANDLER ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message || err);
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Terjadi kesalahan server.',
  });
});

// ── WEBSOCKET SERVER ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const ip     = req.socket.remoteAddress;
  const branch = new URL(req.url, 'http://x').searchParams.get('branch') || 'UNKNOWN';

  console.log(`[WS] Connect  branch=${branch} ip=${ip}`);

  // Kirim state awal
  ws.send(JSON.stringify({ type: 'init', branch, store: store.branches[branch] || null }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      // Update status cabang jika player report heartbeat
      if (msg.type === 'heartbeat' && store.branches[msg.branch]) {
        store.branches[msg.branch].status      = 'online';
        store.branches[msg.branch].lastSeen    = Date.now();
        store.branches[msg.branch].currentContent = msg.currentContent || null;
      }
    } catch (e) {
      console.warn('[WS] Invalid message from', branch, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Disconnect branch=${branch}`);
    if (store.branches[branch]) {
      store.branches[branch].status = 'offline';
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error branch=${branch}:`, err.message);
  });
});

// Ping semua client setiap 30 detik untuk deteksi koneksi mati
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

wss.on('close', () => clearInterval(pingInterval));

// ── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`\n  ▶  RuangTV server berjalan`);
  console.log(`     http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`     ENV=${ENV}  WS=/ws\n`);
});

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────────
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SHUTDOWN] Menerima ${signal} — menutup server...`);

  // Hentikan penerimaan request baru
  server.close((err) => {
    if (err) console.error('[SHUTDOWN] Error menutup HTTP server:', err.message);
    else     console.log('[SHUTDOWN] HTTP server tertutup.');

    // Tutup semua koneksi WebSocket
    wss.clients.forEach(ws => ws.terminate());
    wss.close(() => {
      console.log('[SHUTDOWN] WebSocket server tertutup.');
      process.exit(err ? 1 : 0);
    });
  });

  // Force-kill jika tidak selesai dalam 10 detik
  setTimeout(() => {
    console.error('[SHUTDOWN] Force exit setelah timeout 10 detik.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException',  (err) => { console.error('[UNCAUGHT]', err);  gracefulShutdown('uncaughtException');  });
process.on('unhandledRejection', (err) => { console.error('[UNHANDLED]', err); gracefulShutdown('unhandledRejection'); });
