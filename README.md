# RuangTV Backend API

Backend server untuk sistem Digital Signage RuangTV — Ruangprint Head Office.

## Stack
- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Database**: SQLite (via sql.js) — file `ruangtv.db`
- **Real-time**: WebSocket (`ws`)
- **Auth**: JWT (HS256, native crypto)
- **Upload**: Multer (video, gambar, PDF)

---

## Instalasi & Jalankan

```bash
# 1. Install dependencies
npm install

# 2. Konfigurasi (opsional — ada default)
cp .env.example .env
# Edit .env sesuai kebutuhan

# 3. Jalankan server
npm start

# Development (auto-restart)
npm run dev
```

Server berjalan di: `http://localhost:3001`

---

## Environment Variables (.env)

```env
PORT=3001
JWT_SECRET=ganti-dengan-string-panjang-random
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ruangprint2025
```

---

## API Endpoints

### Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/auth/login` | Login, dapat token JWT |
| GET | `/api/auth/me` | Info user yang login |
| POST | `/api/auth/change-password` | Ganti password |

**Login Request:**
```json
POST /api/auth/login
{ "username": "admin", "password": "ruangprint2025" }
```

**Login Response:**
```json
{ "token": "eyJ...", "user": { "id": "...", "username": "admin", "role": "admin" } }
```

Semua endpoint selain login wajib pakai header:
```
Authorization: Bearer <token>
```

---

### Branches (Cabang)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/branches` | List semua cabang + status |
| GET | `/api/branches/:code` | Detail cabang + TV key |
| POST | `/api/branches` | Tambah cabang baru |
| PUT | `/api/branches/:code` | Edit cabang |
| DELETE | `/api/branches/:code` | Hapus cabang |
| GET | `/api/branches/:code/tv-key` | Generate TV pairing key |

**Tambah Cabang:**
```json
POST /api/branches
{ "code": "SBY", "name": "Ruangprint SBY", "location": "Surabaya", "tv_count": 2 }
```

---

### Contents (Konten)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/contents` | List konten (filter: ?status=live&category=promo) |
| GET | `/api/contents/:id` | Detail konten |
| POST | `/api/contents/upload` | Upload file + buat konten |
| POST | `/api/contents` | Buat konten tanpa file |
| PUT | `/api/contents/:id` | Edit konten |
| POST | `/api/contents/:id/publish` | Publish → langsung push ke TV |
| POST | `/api/contents/:id/unpublish` | Unpublish konten |
| DELETE | `/api/contents/:id` | Hapus konten |

**Upload Konten:**
```
POST /api/contents/upload
Content-Type: multipart/form-data

file: <video/gambar>
name: "Promo Lebaran 2025"
category: "promo"        # promo | discount | menu | info
duration: 30             # detik
targets: "ALL"           # ALL | DMB,CTR,GDS
```

**Status Konten:** `draft` → `scheduled` → `live`

---

### Schedules (Jadwal)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/schedules` | List jadwal (filter: ?date=2025-04-01&branch=DMB) |
| POST | `/api/schedules` | Buat jadwal |
| PUT | `/api/schedules/:id` | Edit jadwal |
| DELETE | `/api/schedules/:id` | Hapus jadwal |

**Buat Jadwal:**
```json
POST /api/schedules
{
  "content_id": "uuid-konten",
  "branch_ids": "DMB,CTR,GDS",
  "time_start": "08:00",
  "time_end": "21:00",
  "date_start": "2025-04-01",
  "date_end": "2025-04-30",
  "repeat": "daily",
  "priority": "high"
}
```

---

### TV / Push
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/tv/status` | Status semua TV (online/offline) |
| POST | `/api/tv/push` | Push konten ke TV tertentu |
| POST | `/api/tv/push-playlist` | Push full playlist ke cabang |
| POST | `/api/tv/command` | Kirim perintah ke TV |
| GET | `/api/tv/:code/playlist` | Playlist aktif per cabang |

**Push ke TV:**
```json
POST /api/tv/push
{ "contentId": "uuid", "branchCodes": ["DMB", "CTR"] }
```

**Perintah TV:**
```json
POST /api/tv/command
{ "branchCode": "DMB", "command": "RELOAD" }
// command: RELOAD | RESTART | MUTE | UNMUTE | NEXT
```

---

### Stats
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/stats` | Ringkasan statistik dashboard |
| GET | `/health` | Health check server |

---

## WebSocket

### TV Player (Smart TV di cabang)
```
ws://YOUR_SERVER:3001/ws?branch=DMB&key=<tv-key>
```

Dapatkan `tv-key` dari: `GET /api/branches/DMB/tv-key`

**Messages dari server ke TV:**
```json
{ "type": "CONNECTED", "branchCode": "DMB" }
{ "type": "PUSH_CONTENT", "content": {...} }
{ "type": "PLAYLIST_UPDATE", "playlist": [...] }
{ "type": "COMMAND", "command": "RELOAD" }
```

**Messages dari TV ke server:**
```json
{ "type": "HEARTBEAT" }
{ "type": "CONTENT_PLAYING", "contentId": "...", "contentName": "..." }
{ "type": "CONTENT_ERROR", "error": "..." }
```

### HO Dashboard (monitoring real-time)
```
ws://YOUR_SERVER:3001/ws?type=ho&token=<jwt-token>
```

**Messages yang diterima HO:**
```json
{ "type": "TV_ONLINE", "branchCode": "DMB" }
{ "type": "TV_OFFLINE", "branchCode": "BKS" }
{ "type": "CONTENT_PLAYING", "branchCode": "DMB", "contentName": "..." }
{ "type": "STATUS_SNAPSHOT", "onlineBranches": ["DMB", "CTR"] }
```

---

## Struktur File

```
ruangtv-backend/
├── server.js          # Entry point
├── .env               # Konfigurasi
├── ruangtv.db         # Database SQLite (auto-created)
├── uploads/           # File yang diupload
├── src/
│   ├── database.js    # DB init, query helpers, seed data
│   ├── auth.js        # JWT sign/verify, middleware
│   ├── websocket.js   # WS server, push ke TV, HO feed
│   └── routes.js      # Semua API routes
└── package.json
```

---

## Deploy ke VPS/Server

```bash
# Install Node.js di server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Copy project ke server
scp -r ruangtv-backend/ user@server:/home/user/

# Install & start
cd ruangtv-backend && npm install
npm start

# Pakai PM2 untuk production (auto-restart)
npm install -g pm2
pm2 start server.js --name ruangtv
pm2 save && pm2 startup
```

---

## Sambungkan Frontend ke Backend

Di file `ruangtv-dashboard.html`, ganti URL API:

```javascript
const API_BASE = 'http://YOUR_SERVER_IP:3001/api';
const WS_URL = 'ws://YOUR_SERVER_IP:3001/ws';

// Login
const res = await fetch(`${API_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'ruangprint2025' })
});
const { token } = await res.json();

// Get branches
const branches = await fetch(`${API_BASE}/branches`, {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());
```
"# RuangTV" 
