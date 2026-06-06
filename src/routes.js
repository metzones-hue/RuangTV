const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { query, run, get, hashPassword, newId } = require('./database');
const { signToken, requireAuth, generateTvKey } = require('./auth');
const { pushContentToAll, pushContentToTv, getOnlineBranches, isTvOnline, registerHO } = require('./websocket');
const { uploadToDrive, deleteFromDrive } = require('./gdrive');

const router = express.Router();

// ── File upload config (temp dir sebelum upload ke GDrive) ───────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|mov|avi|webm|jpg|jpeg|png|gif|pdf|pptx)$/i;
    if (allowed.test(file.originalname)) cb(null, true);
    else cb(new Error('Format file tidak didukung'));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/login
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }
  const user = get(`SELECT * FROM users WHERE username = ?`, [username]);
  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }
  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// GET /api/auth/me
router.get('/auth/me', requireAuth, (req, res) => {
  const user = get(`SELECT id, username, role, created_at FROM users WHERE id = ?`, [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  res.json(user);
});

// POST /api/auth/change-password
router.post('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  if (!user || user.password !== hashPassword(currentPassword)) {
    return res.status(400).json({ error: 'Password lama tidak sesuai' });
  }
  run(`UPDATE users SET password = ? WHERE id = ?`, [hashPassword(newPassword), req.user.id]);
  res.json({ message: 'Password berhasil diubah' });
});

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/branches
router.get('/branches', requireAuth, (req, res) => {
  const branches = query(`SELECT * FROM branches ORDER BY code ASC`);
  const onlineBranches = getOnlineBranches();
  // Inject status: manual override wins, otherwise auto from WebSocket
  const result = branches.map(b => {
    const autoOnline = onlineBranches.includes(b.code);
    let status;
    if (b.manual_override === 'online')  status = 'online';
    else if (b.manual_override === 'offline') status = 'offline';
    else status = autoOnline ? 'online' : 'offline';
    return {
      ...b,
      ws_connected: autoOnline,
      status,
      is_overridden: b.manual_override === 'online' || b.manual_override === 'offline',
    };
  });
  res.json(result);
});

// PUT /api/branches/:code/override — set manual online/offline toggle
router.put('/branches/:code/override', requireAuth, (req, res) => {
  const code = req.params.code.toUpperCase();
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [code]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });

  // mode: 'online' | 'offline' | 'auto'
  const { mode } = req.body;
  const override = (mode === 'online' || mode === 'offline') ? mode : null;

  run(`UPDATE branches SET manual_override = ? WHERE code = ?`, [override, code]);

  const autoOnline = isTvOnline(code);
  let status;
  if (override === 'online') status = 'online';
  else if (override === 'offline') status = 'offline';
  else status = autoOnline ? 'online' : 'offline';

  res.json({ branchCode: code, manual_override: override, status, ws_connected: autoOnline });
});

// GET /api/branches/:code
router.get('/branches/:code', requireAuth, (req, res) => {
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [req.params.code.toUpperCase()]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });
  const autoOnline = isTvOnline(branch.code);
  let status;
  if (branch.manual_override === 'online') status = 'online';
  else if (branch.manual_override === 'offline') status = 'offline';
  else status = autoOnline ? 'online' : 'offline';
  branch.ws_connected = autoOnline;
  branch.status = status;
  branch.is_overridden = branch.manual_override === 'online' || branch.manual_override === 'offline';
  // Get TV key for this branch
  branch.tv_key = generateTvKey(branch.code);
  res.json(branch);
});

// POST /api/branches
router.post('/branches', requireAuth, (req, res) => {
  const { code, name, location, tv_count } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'Code dan nama cabang wajib diisi' });

  const existing = get(`SELECT id FROM branches WHERE code = ?`, [code.toUpperCase()]);
  if (existing) return res.status(409).json({ error: `Kode cabang ${code} sudah digunakan` });

  const id = newId();
  run(`INSERT INTO branches (id,code,name,location,tv_count) VALUES (?,?,?,?,?)`,
    [id, code.toUpperCase(), name, location || '', tv_count || 1]);

  const branch = get(`SELECT * FROM branches WHERE id = ?`, [id]);
  branch.tv_key = generateTvKey(branch.code);
  res.status(201).json(branch);
});

// PUT /api/branches/:code
router.put('/branches/:code', requireAuth, (req, res) => {
  const { name, location, tv_count } = req.body;
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [req.params.code.toUpperCase()]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });

  run(`UPDATE branches SET name=?, location=?, tv_count=? WHERE code=?`,
    [name || branch.name, location || branch.location, tv_count || branch.tv_count, branch.code]);

  res.json(get(`SELECT * FROM branches WHERE code = ?`, [branch.code]));
});

// DELETE /api/branches/:code
router.delete('/branches/:code', requireAuth, (req, res) => {
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [req.params.code.toUpperCase()]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });
  run(`DELETE FROM branches WHERE code = ?`, [branch.code]);
  res.json({ message: `Cabang ${branch.code} berhasil dihapus` });
});

// GET /api/branches/:code/tv-key — public endpoint for TV player
router.get('/branches/:code/tv-key', (req, res) => {
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [req.params.code.toUpperCase()]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });
  const tvKey = generateTvKey(branch.code);
  const wsUrl = `ws://YOUR_SERVER_IP:3001/ws?branch=${branch.code}&key=${tvKey}`;
  res.json({ branchCode: branch.code, tvKey, wsUrl });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contents
router.get('/contents', requireAuth, (req, res) => {
  const { status, category } = req.query;
  let sql = `SELECT * FROM contents WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (category) { sql += ` AND category = ?`; params.push(category); }
  sql += ` ORDER BY created_at DESC`;
  res.json(query(sql, params));
});

// GET /api/contents/:id
router.get('/contents/:id', requireAuth, (req, res) => {
  const content = get(`SELECT * FROM contents WHERE id = ?`, [req.params.id]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });
  res.json(content);
});

// POST /api/contents/upload — upload file + create content record
router.post('/contents/upload', requireAuth, upload.single('file'), async (req, res) => {
  const { name, category, duration, resolution, targets, notes } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Nama dan kategori wajib diisi' });

  const id = newId();
  let fileUrl = null;
  let filename = null;
  let fileSize = 0;
  let gdriveId = null;

  if (req.file) {
    fileSize = req.file.size;
    filename = req.file.filename;
    try {
      const result = await uploadToDrive(req.file.path, req.file.originalname, req.file.mimetype);
      fileUrl = result.directUrl;
      gdriveId = result.fileId;
      // Hapus file temp setelah upload ke GDrive
      fs.unlink(req.file.path, () => {});
    } catch (e) {
      console.error('GDrive upload error:', e.message);
      // Fallback ke local jika GDrive gagal
      fileUrl = `/uploads/${req.file.filename}`;
    }
  }

  run(`INSERT INTO contents (id,name,category,filename,file_url,duration,resolution,file_size,targets,notes,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`,
    [id, name, category, gdriveId || filename, fileUrl, duration || 30, resolution || '1920x1080', fileSize, targets || 'ALL', notes || '']);

  res.status(201).json(get(`SELECT * FROM contents WHERE id = ?`, [id]));
});

// POST /api/contents — create content record without file (for slides/external)
router.post('/contents', requireAuth, (req, res) => {
  const { name, category, duration, resolution, targets, notes, file_url } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Nama dan kategori wajib diisi' });

  const id = newId();
  run(`INSERT INTO contents (id,name,category,file_url,duration,resolution,targets,notes,status)
       VALUES (?,?,?,?,?,?,?,?,'draft')`,
    [id, name, category, file_url || '', duration || 30, resolution || '1920x1080', targets || 'ALL', notes || '']);

  res.status(201).json(get(`SELECT * FROM contents WHERE id = ?`, [id]));
});

// PUT /api/contents/:id
router.put('/contents/:id', requireAuth, (req, res) => {
  const content = get(`SELECT * FROM contents WHERE id = ?`, [req.params.id]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });

  const { name, category, duration, resolution, targets, notes, status } = req.body;
  run(`UPDATE contents SET name=?,category=?,duration=?,resolution=?,targets=?,notes=?,status=?,
       updated_at=datetime('now','localtime') WHERE id=?`,
    [name||content.name, category||content.category, duration||content.duration,
     resolution||content.resolution, targets||content.targets, notes||content.notes,
     status||content.status, content.id]);

  const updated = get(`SELECT * FROM contents WHERE id = ?`, [content.id]);

  // If now live, push to connected TVs
  if (status === 'live') {
    const targetList = (targets || content.targets) === 'ALL'
      ? null
      : (targets || content.targets).split(',').map(t => t.trim());
    pushContentToAll(updated, targetList);
  }

  res.json(updated);
});

// POST /api/contents/:id/publish — set live and push to TVs
router.post('/contents/:id/publish', requireAuth, (req, res) => {
  const content = get(`SELECT * FROM contents WHERE id = ?`, [req.params.id]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });

  run(`UPDATE contents SET status='live', updated_at=datetime('now','localtime') WHERE id=?`, [content.id]);
  const updated = get(`SELECT * FROM contents WHERE id = ?`, [content.id]);

  const targetList = updated.targets === 'ALL' ? null : updated.targets.split(',').map(t => t.trim());
  const pushResults = pushContentToAll(updated, targetList);

  res.json({ content: updated, pushResults, message: 'Konten dipublish dan dikirim ke TV' });
});

// POST /api/contents/:id/unpublish
router.post('/contents/:id/unpublish', requireAuth, (req, res) => {
  const content = get(`SELECT * FROM contents WHERE id = ?`, [req.params.id]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });

  run(`UPDATE contents SET status='draft', updated_at=datetime('now','localtime') WHERE id=?`, [content.id]);

  // Push playlist update to all TVs
  const liveContents = query(`SELECT * FROM contents WHERE status = 'live'`);
  pushContentToAll({ type: 'PLAYLIST_FULL', contents: liveContents });

  res.json({ message: 'Konten di-unpublish', content: get(`SELECT * FROM contents WHERE id = ?`, [content.id]) });
});

// DELETE /api/contents/:id
router.delete('/contents/:id', requireAuth, (req, res) => {
  const content = get(`SELECT * FROM contents WHERE id = ?`, [req.params.id]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });

  // Delete file if exists
  if (content.filename) {
    const filePath = path.join(UPLOAD_DIR, content.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  run(`DELETE FROM contents WHERE id = ?`, [content.id]);
  res.json({ message: 'Konten berhasil dihapus' });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/schedules
router.get('/schedules', requireAuth, (req, res) => {
  const { date, branch } = req.query;
  let sql = `
    SELECT s.*, c.name as content_name, c.category, c.duration, c.file_url
    FROM schedules s
    JOIN contents c ON s.content_id = c.id
    WHERE s.active = 1
  `;
  const params = [];
  if (date) { sql += ` AND s.date_start <= ? AND (s.date_end IS NULL OR s.date_end >= ?)`; params.push(date, date); }
  if (branch) { sql += ` AND (s.branch_ids = 'ALL' OR s.branch_ids LIKE ?)`; params.push(`%${branch}%`); }
  sql += ` ORDER BY s.time_start ASC`;
  res.json(query(sql, params));
});

// POST /api/schedules
router.post('/schedules', requireAuth, (req, res) => {
  const { content_id, branch_ids, time_start, time_end, date_start, date_end, repeat, priority } = req.body;
  if (!content_id || !branch_ids || !time_start || !time_end || !date_start) {
    return res.status(400).json({ error: 'Data jadwal tidak lengkap' });
  }
  const content = get(`SELECT * FROM contents WHERE id = ?`, [content_id]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });

  const id = newId();
  run(`INSERT INTO schedules (id,content_id,branch_ids,time_start,time_end,date_start,date_end,repeat,priority)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, content_id, branch_ids, time_start, time_end, date_start, date_end||null, repeat||'daily', priority||'normal']);

  // Auto-set content to scheduled if still draft
  if (content.status === 'draft') {
    run(`UPDATE contents SET status='scheduled', updated_at=datetime('now','localtime') WHERE id=?`, [content_id]);
  }

  res.status(201).json(get(`
    SELECT s.*, c.name as content_name FROM schedules s
    JOIN contents c ON s.content_id = c.id WHERE s.id = ?`, [id]));
});

// PUT /api/schedules/:id
router.put('/schedules/:id', requireAuth, (req, res) => {
  const schedule = get(`SELECT * FROM schedules WHERE id = ?`, [req.params.id]);
  if (!schedule) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });

  const { branch_ids, time_start, time_end, date_start, date_end, repeat, priority, active } = req.body;
  run(`UPDATE schedules SET branch_ids=?,time_start=?,time_end=?,date_start=?,date_end=?,repeat=?,priority=?,active=? WHERE id=?`,
    [branch_ids||schedule.branch_ids, time_start||schedule.time_start, time_end||schedule.time_end,
     date_start||schedule.date_start, date_end||schedule.date_end, repeat||schedule.repeat,
     priority||schedule.priority, active !== undefined ? active : schedule.active, schedule.id]);

  res.json(get(`SELECT * FROM schedules WHERE id = ?`, [schedule.id]));
});

// DELETE /api/schedules/:id
router.delete('/schedules/:id', requireAuth, (req, res) => {
  const schedule = get(`SELECT * FROM schedules WHERE id = ?`, [req.params.id]);
  if (!schedule) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
  run(`DELETE FROM schedules WHERE id = ?`, [schedule.id]);
  res.json({ message: 'Jadwal berhasil dihapus' });
});

// ─────────────────────────────────────────────────────────────────────────────
// TV / PUSH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tv/status — all branch statuses
router.get('/tv/status', requireAuth, (req, res) => {
  const branches = query(`SELECT * FROM branches ORDER BY code`);
  const onlineBranches = getOnlineBranches();
  const result = branches.map(b => ({
    ...b,
    online: onlineBranches.includes(b.code),
  }));
  res.json({ branches: result, onlineCount: onlineBranches.length, totalCount: branches.length });
});

// POST /api/tv/push — push content to specific branch(es)
router.post('/tv/push', requireAuth, (req, res) => {
  const { contentId, branchCodes } = req.body;
  const content = get(`SELECT * FROM contents WHERE id = ?`, [contentId]);
  if (!content) return res.status(404).json({ error: 'Konten tidak ditemukan' });

  let results = {};
  if (branchCodes && branchCodes.length > 0) {
    branchCodes.forEach(code => {
      results[code] = pushContentToTv(code, content);
    });
  } else {
    results = pushContentToAll(content);
  }

  const sent = Object.values(results).filter(Boolean).length;
  res.json({ message: `Konten dikirim ke ${sent} TV`, results });
});

// POST /api/tv/push-playlist — push full playlist to branch
router.post('/tv/push-playlist', requireAuth, (req, res) => {
  const { branchCode } = req.body;
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [(branchCode||'').toUpperCase()]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });

  const code = branch.code;
  const allLive = query(`SELECT * FROM contents WHERE status = 'live' ORDER BY id ASC`);
  const liveContents = allLive.filter(c => {
    const t = (c.targets || 'ALL').toUpperCase().trim();
    if (t === 'ALL' || t === '') return true;
    return t.split(',').map(x => x.trim()).filter(Boolean).includes(code);
  });

  const sent = pushContentToTv(code, {
    type: 'PLAYLIST_UPDATE',
    playlist: liveContents,
  });

  res.json({ message: sent ? 'Playlist dikirim' : 'TV offline', contents: liveContents.length });
});

// POST /api/tv/command — send command to TV (restart, reload, etc)
router.post('/tv/command', requireAuth, (req, res) => {
  const { branchCode, command, params: cmdParams } = req.body;
  if (!branchCode || !command) return res.status(400).json({ error: 'branchCode dan command wajib diisi' });

  const sent = pushContentToTv(branchCode.toUpperCase(), {
    type: 'COMMAND',
    command,
    params: cmdParams || {},
    timestamp: new Date().toISOString(),
  });

  res.json({ message: sent ? `Perintah ${command} dikirim` : 'TV offline', sent });
});

// GET /api/tv/:code/playlist — public endpoint for TV players
router.get('/tv/:code/playlist', (req, res) => {
  const code = req.params.code.toUpperCase();
  const branch = get(`SELECT * FROM branches WHERE code = ?`, [code]);
  if (!branch) return res.status(404).json({ error: 'Cabang tidak ditemukan' });

  // Get all live content, then filter by target in JS (robust against spaces/case)
  const allLive = query(`SELECT * FROM contents WHERE status = 'live' ORDER BY id ASC`);

  const playlist = allLive.filter(c => {
    const t = (c.targets || 'ALL').toUpperCase().trim();
    if (t === 'ALL' || t === '') return true;
    // Split on comma, trim each, compare exact code match
    const list = t.split(',').map(x => x.trim()).filter(Boolean);
    return list.includes(code);
  });

  // Prevent any caching so all devices get identical, fresh playlist
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  res.json({ branchCode: code, playlist, count: playlist.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS / DASHBOARD ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/stats — dashboard summary
router.get('/stats', requireAuth, (req, res) => {
  const totalBranches = get(`SELECT COUNT(*) as c FROM branches`)?.c || 0;
  const totalContents = get(`SELECT COUNT(*) as c FROM contents`)?.c || 0;
  const liveContents = get(`SELECT COUNT(*) as c FROM contents WHERE status='live'`)?.c || 0;
  const draftContents = get(`SELECT COUNT(*) as c FROM contents WHERE status='draft'`)?.c || 0;
  const scheduledContents = get(`SELECT COUNT(*) as c FROM contents WHERE status='scheduled'`)?.c || 0;
  const totalSchedules = get(`SELECT COUNT(*) as c FROM schedules WHERE active=1`)?.c || 0;
  const onlineBranches = getOnlineBranches();

  res.json({
    branches: { total: totalBranches, online: onlineBranches.length, offline: totalBranches - onlineBranches.length },
    contents: { total: totalContents, live: liveContents, draft: draftContents, scheduled: scheduledContents },
    schedules: { active: totalSchedules },
    onlineBranches,
  });
});

// GET /api/tv/ws-upgrade — handle HO dashboard WS connection
router.get('/tv/ho-connect', requireAuth, (req, res) => {
  res.json({ message: 'Connect via WebSocket at /ws?type=ho', token: req.headers.authorization?.slice(7) });
});

module.exports = router;
