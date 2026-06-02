require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { initDb } = require('./src/database');
const { initWebSocket, registerHO, broadcastToHO } = require('./src/websocket');
const { verifyToken, generateTvKey } = require('./src/auth');
const routes = require('./src/routes');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Security Headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  // Izinkan konten dari origin yang sama (untuk player & dashboard)
  contentSecurityPolicy: false,
  // Izinkan embedding di iframe (untuk preview player)
  frameguard: false,
  // Izinkan cross-origin resources (font, gambar)
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*'];

app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS: origin tidak diizinkan'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-TV-Key', 'X-Branch-Code', 'Accept'],
  credentials: false,
}));

app.options('*', cors());

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Global limiter — semua endpoint
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak request. Coba lagi dalam beberapa menit.' },
  skip: (req) => req.path === '/health', // skip health check
});

// Login limiter — lebih ketat untuk mencegah brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10,                   // maksimal 10 percobaan login per 15 menit per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  skipSuccessfulRequests: true, // tidak hitung request yang berhasil
});

app.use(globalLimiter);
app.use('/api/auth/login', loginLimiter);

// ── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static Files ──────────────────────────────────────────────────────────────
// Serve uploaded files dengan header keamanan
app.use('/uploads', (req, res, next) => {
  // Cegah eksekusi script dari folder uploads
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Serve frontend static files
const frontendPath = path.join(__dirname, 'public');
if (require('fs').existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

// ── Request Logger (development only) ────────────────────────────────────────
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path}`);
    }
    next();
  });
}

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RuangTV Backend',
    version: '2.0.0',
    env: NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ── SPA Fallback — serve index.html untuk semua route non-API ─────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) {
    return next();
  }
  const indexPath = path.join(frontendPath, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} tidak ditemukan` });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Jangan expose stack trace di production
  const isDev = NODE_ENV === 'development';
  console.error('Server error:', err.message);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File terlalu besar (maksimal 500MB)' });
  }
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: err.message });
  }

  res.status(500).json({
    error: err.message || 'Internal server error',
    ...(isDev && { stack: err.stack }),
  });
});

// ── WebSocket — upgrade handler ───────────────────────────────────────────────
const wss = initWebSocket(server);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const type = url.searchParams.get('type');

  if (type === 'ho') {
    const token = url.searchParams.get('token');
    const payload = verifyToken(token);
    if (!payload) {
      ws.close(4003, 'Invalid HO token');
      return;
    }
    registerHO(ws);
    console.log(`🖥️  HO Dashboard connected (user: ${payload.username})`);
  }
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n${signal} diterima. Menutup server...`);
  server.close(() => {
    console.log('✓ Server ditutup dengan bersih');
    process.exit(0);
  });
  // Force close setelah 10 detik
  setTimeout(() => { console.error('Force shutdown'); process.exit(1); }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log('\n╔══════════════════════════════════════════╗');
      console.log('║        RuangTV Backend Server v2.0       ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  HTTP  → http://localhost:${PORT}          ║`);
      console.log(`║  WS    → ws://localhost:${PORT}/ws         ║`);
      console.log(`║  Env   → ${NODE_ENV.padEnd(32)}║`);
      console.log('╠══════════════════════════════════════════╣');
      console.log('║  Dashboard → /ruangtv-dashboard.html     ║');
      console.log('║  Player   → /player.html?branch=DMB      ║');
      console.log('╚══════════════════════════════════════════╝\n');

      // Print TV keys untuk semua cabang
      const branches = ['DMB', 'CTR', 'GDS', 'CGK', 'BKS'];
      console.log('📺 TV Keys (pasang di Smart TV tiap cabang):');
      branches.forEach(code => {
        const key = generateTvKey(code);
        console.log(`  ${code}: ${key.slice(0, 20)}...`);
      });
      console.log('\n✅ Server siap! Login: POST /api/auth/login\n');
    });
  } catch (err) {
    console.error('Gagal start server:', err);
    process.exit(1);
  }
}

start();
