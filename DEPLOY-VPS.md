# Deploy RuangTV ke VPS (Ubuntu/Debian) — PM2 + Nginx

## Prasyarat VPS
- Ubuntu 20.04 / 22.04 atau Debian 11/12
- Minimal RAM 512 MB, disarankan 1 GB
- Akses root atau sudo
- Domain sudah diarahkan ke IP VPS (opsional tapi disarankan)

---

## LANGKAH 1 — Update & Install Node.js

```bash
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi
node -v   # harus v20.x.x
npm -v
```

---

## LANGKAH 2 — Install PM2 & Nginx

```bash
# PM2 (process manager)
sudo npm install -g pm2

# Nginx (reverse proxy)
sudo apt install -y nginx

# Verifikasi
pm2 -v
nginx -v
```

---

## LANGKAH 3 — Clone Repository

```bash
# Buat direktori app
sudo mkdir -p /var/www/ruangtv
sudo chown $USER:$USER /var/www/ruangtv

# Clone repo (ganti dengan URL repo kamu)
cd /var/www
git clone https://github.com/metzones-hue/ruangtv.git ruangtv
cd ruangtv

# Install dependencies (production only)
npm install --omit=dev
```

---

## LANGKAH 4 — Konfigurasi Environment

```bash
# Salin template env
cp env.example .env

# Edit file .env
nano .env
```

Isi `.env` untuk production:

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# URL publik server kamu (pakai domain atau IP)
PUBLIC_URL=https://ruangtv.domainmu.id

# Ganti dengan string acak minimal 32 karakter!
SESSION_SECRET=ganti_ini_dengan_random_string_panjang_sekali

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120

# CORS — sesuaikan dengan domain frontend
CORS_ORIGINS=https://ruangtv.domainmu.id

LOG_FORMAT=combined
CONTENT_DIR=./content
MAX_UPLOAD_SIZE_MB=200
```

---

## LANGKAH 5 — Jalankan dengan PM2

```bash
cd /var/www/ruangtv

# Start app pakai ecosystem config
pm2 start ecosystem.config.js --env production

# Cek status
pm2 status

# Lihat log
pm2 logs ruangtv

# Set PM2 auto-start saat reboot
pm2 startup
# → Jalankan perintah yang muncul dari output di atas

pm2 save
```

---

## LANGKAH 6 — Konfigurasi Nginx

```bash
# Buat config Nginx baru
sudo nano /etc/nginx/sites-available/ruangtv
```

Isi file config Nginx (ganti `ruangtv.domainmu.id` dengan domain/IP VPS kamu):

```nginx
server {
    listen 80;
    server_name ruangtv.domainmu.id;   # atau IP VPS jika tidak pakai domain

    # Upload size limit
    client_max_body_size 210M;

    # Proxy ke Node.js
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

```bash
# Aktifkan config
sudo ln -s /etc/nginx/sites-available/ruangtv /etc/nginx/sites-enabled/

# Test config Nginx
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## LANGKAH 7 — HTTPS dengan Let's Encrypt (opsional tapi sangat disarankan)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Dapatkan sertifikat SSL (ganti dengan domain kamu)
sudo certbot --nginx -d ruangtv.domainmu.id

# Auto-renewal
sudo systemctl enable certbot.timer
```

---

## LANGKAH 8 — Firewall

```bash
# Aktifkan UFW
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Cek status
sudo ufw status
```

---

## Perintah PM2 Berguna

```bash
pm2 status              # lihat semua app
pm2 logs ruangtv        # lihat log realtime
pm2 restart ruangtv     # restart app
pm2 stop ruangtv        # stop app
pm2 reload ruangtv      # zero-downtime reload
```

## Update App (ketika ada kode baru)

```bash
cd /var/www/ruangtv
git pull origin main
npm install --omit=dev
pm2 reload ruangtv
```

---

## Cek Kesehatan Server

Buka di browser:
```
http://ruangtv.domainmu.id/health
```

Harus muncul response JSON seperti:
```json
{
  "status": "ok",
  "service": "RuangTV Backend",
  "version": "1.0.0"
}
```
