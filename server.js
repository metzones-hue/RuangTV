require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

const { initDb } = require('./src/database');
const { initWebSocket, registerHO, broadcastToHO } = require('./src/websocket');
const { verifyToken, generateTvKey } = require('./src/auth');
const routes = require('./src/routes');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-TV-Key', 'X-Branch-Code', 'Accept'],
  credentials: false,
}));

// Handle preflight
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend static files (for production)
const frontendPath = path.join(__dirname, '..', 'public');
if (require('fs').existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RuangTV Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} tidak ditemukan` });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File terlalu besar (maksimal 500MB)' });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── WebSocket — upgrade handler ───────────────────────────────────────────────
const wss = initWebSocket(server);

// Handle HO dashboard WebSocket connections (path: /ws?type=ho&token=...)
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const type = url.searchParams.get('type');

  if (type === 'ho') {
    // HO Dashboard connecting for live status feed
    const token = url.searchParams.get('token');
    const payload = verifyToken(token);
    if (!payload) {
      ws.close(4003, 'Invalid HO token');
      return;
    }
    registerHO(ws);
    console.log(`🖥️  HO Dashboard connected (user: ${payload.username})`);
  }
  // TV connections are handled in websocket.js
});

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log('\n╔══════════════════════════════════════════╗');
      console.log('║        RuangTV Backend Server            ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  HTTP  → http://localhost:${PORT}          ║`);
      console.log(`║  WS    → ws://localhost:${PORT}/ws         ║`);
      console.log(`║  Docs  → http://localhost:${PORT}/health   ║`);
      console.log('╠══════════════════════════════════════════╣');
      console.log('║  TV Player URL per cabang:               ║');
      console.log('║  /ws?branch=DMB&key=<tv-key>             ║');
      console.log('╚══════════════════════════════════════════╝\n');

      // Print TV keys for all branches
      const branches = ['DMB', 'CTR', 'GDS', 'CGK', 'BKS'];
      console.log('📺 TV Keys (pasang di Smart TV tiap cabang):');
      branches.forEach(code => {
        const key = generateTvKey(code);
        console.log(`  ${code}: ${key.slice(0, 16)}...`);
      });
      console.log('\n✅ Server siap! Login: POST /api/auth/login\n');
    });
  } catch (err) {
    console.error('Gagal start server:', err);
    process.exit(1);
  }
}

start();
