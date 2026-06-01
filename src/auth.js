const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'ruangtv-secret-key';

// ── Lightweight JWT (HS256) — no external deps ─────────────────────────────
function signToken(payload, expiresInHours = 24) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const data = Buffer.from(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${data}`).digest('base64url');
  return `${header}.${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, data, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SECRET).update(`${header}.${data}`).digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Express middleware ─────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Token tidak valid atau sudah expired' });
  }
  req.user = payload;
  next();
}

// ── TV device auth (simpler — uses branch code as key) ─────────────────────
function requireTvAuth(req, res, next) {
  const tvKey = req.headers['x-tv-key'];
  const branchCode = req.headers['x-branch-code'];
  if (!tvKey || !branchCode) {
    return res.status(401).json({ error: 'TV key atau branch code tidak ditemukan' });
  }
  const expectedKey = crypto.createHmac('sha256', SECRET).update(branchCode).digest('hex');
  if (tvKey !== expectedKey) {
    return res.status(401).json({ error: 'TV key tidak valid' });
  }
  req.branchCode = branchCode;
  next();
}

function generateTvKey(branchCode) {
  return crypto.createHmac('sha256', SECRET).update(branchCode).digest('hex');
}

module.exports = { signToken, verifyToken, requireAuth, requireTvAuth, generateTvKey };
