const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'ruangtv.db');

let db = null;

// ── tiny helpers ──────────────────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'ruangtv_salt').digest('hex');
}

function newId() {
  return crypto.randomUUID();
}

// ── save DB to disk ───────────────────────────────────────────────────────────
function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── init ──────────────────────────────────────────────────────────────────────
async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✓ Database loaded from disk');
  } else {
    db = new SQL.Database();
    console.log('✓ New database created');
  }

  // ── SCHEMA ──────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS branches (
      id          TEXT PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      location    TEXT,
      tv_count    INTEGER DEFAULT 1,
      status      TEXT DEFAULT 'offline',
      last_seen   TEXT,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS contents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      filename    TEXT,
      file_url    TEXT,
      duration    INTEGER DEFAULT 30,
      resolution  TEXT DEFAULT '1920x1080',
      file_size   INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'draft',
      targets     TEXT DEFAULT 'ALL',
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now','localtime')),
      updated_at  TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id          TEXT PRIMARY KEY,
      content_id  TEXT NOT NULL,
      branch_ids  TEXT NOT NULL,
      time_start  TEXT NOT NULL,
      time_end    TEXT NOT NULL,
      date_start  TEXT NOT NULL,
      date_end    TEXT,
      repeat      TEXT DEFAULT 'daily',
      priority    TEXT DEFAULT 'normal',
      active      INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (content_id) REFERENCES contents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tv_logs (
      id          TEXT PRIMARY KEY,
      branch_id   TEXT NOT NULL,
      event       TEXT NOT NULL,
      detail      TEXT,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT DEFAULT 'admin',
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // ── SEED DATA ────────────────────────────────────────────────────────────────
  const existingBranches = db.exec("SELECT COUNT(*) as c FROM branches")[0];
  const branchCount = existingBranches ? existingBranches.values[0][0] : 0;

  if (branchCount === 0) {
    const branches = [
      { id: newId(), code: 'DMB', name: 'Ruangprint DMB', location: 'Depok, Margonda', status: 'online' },
      { id: newId(), code: 'CTR', name: 'Ruangprint CTR', location: 'Jakarta, Citraland', status: 'online' },
      { id: newId(), code: 'GDS', name: 'Ruangprint GDS', location: 'Jakarta, Gandaria', status: 'online' },
      { id: newId(), code: 'CGK', name: 'Ruangprint CGK', location: 'Tangerang, Cengkareng', status: 'online' },
      { id: newId(), code: 'BKS', name: 'Ruangprint BKS', location: 'Bekasi, Kota', status: 'offline' },
    ];
    const stmt = db.prepare(`INSERT INTO branches (id,code,name,location,status,last_seen) VALUES (?,?,?,?,?,datetime('now','localtime'))`);
    branches.forEach(b => stmt.run([b.id, b.code, b.name, b.location, b.status]));
    stmt.free();

    const contents = [
      { id: newId(), name: 'Promo Lebaran 2025', category: 'promo', duration: 30, status: 'live', targets: 'ALL' },
      { id: newId(), name: 'Diskon Member 20%', category: 'discount', duration: 20, status: 'live', targets: 'CTR,DMB' },
      { id: newId(), name: 'Menu Layanan Print', category: 'menu', duration: 45, status: 'live', targets: 'CGK' },
      { id: newId(), name: 'Info Layanan Baru', category: 'info', duration: 45, status: 'live', targets: 'GDS' },
      { id: newId(), name: 'Launching Produk Baru', category: 'promo', duration: 60, status: 'scheduled', targets: 'ALL' },
      { id: newId(), name: 'Harga Spesial Akhir Tahun', category: 'discount', duration: 30, status: 'draft', targets: '' },
    ];
    const cstmt = db.prepare(`INSERT INTO contents (id,name,category,duration,status,targets) VALUES (?,?,?,?,?,?)`);
    contents.forEach(c => cstmt.run([c.id, c.name, c.category, c.duration, c.status, c.targets]));
    cstmt.free();

    // Default admin user
    const envUser = process.env.ADMIN_USERNAME || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'ruangprint2025';
    db.run(`INSERT OR IGNORE INTO users (id,username,password,role) VALUES (?,?,?,?)`,
      [newId(), envUser, hashPassword(envPass), 'admin']);

    saveDb();
    console.log('✓ Seed data inserted');
  }

  return db;
}

// ── query helpers ─────────────────────────────────────────────────────────────
function query(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function run(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  db.run(sql, params);
  saveDb();
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

module.exports = { initDb, query, run, get, saveDb, hashPassword, newId };
