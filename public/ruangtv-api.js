// ============================================================
//  RuangTV — API Client & Auth Layer v2.0
//  Include di semua halaman: <script src="ruangtv-api.js"></script>
// ============================================================
const API = (() => {
  // ── Auto-detect server URL (no more hardcoded localhost!) ──────────────────
  // Jika ada override global (untuk konfigurasi khusus), gunakan itu.
  // Jika tidak, gunakan origin yang sama dengan halaman ini.
  const BASE_URL = window.RUANGTV_API_URL || window.location.origin;
  const BASE = BASE_URL + '/api';

  // WebSocket: otomatis deteksi ws:// atau wss:// sesuai protokol halaman
  const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_HOST = (window.RUANGTV_WS_URL || window.location.host);
  const WS_BASE = `${WS_PROTOCOL}//${WS_HOST}`;

  // ── Token & User storage ───────────────────────────────────────────────────
  const getToken = () => localStorage.getItem('ruangtv_token');
  const setToken = t => localStorage.setItem('ruangtv_token', t);
  const clearToken = () => {
    localStorage.removeItem('ruangtv_token');
    localStorage.removeItem('ruangtv_user');
  };
  const getUser = () => {
    try { return JSON.parse(localStorage.getItem('ruangtv_user')); } catch { return null; }
  };
  const setUser = u => localStorage.setItem('ruangtv_user', JSON.stringify(u));

  const requireAuth = () => {
    if (!getToken()) { window.location.href = 'ruangtv-login.html'; return false; }
    return true;
  };

  // ── HTTP request helper ────────────────────────────────────────────────────
  const req = async (method, path, body = null, isForm = false) => {
    const headers = { Authorization: `Bearer ${getToken()}` };
    if (!isForm) headers['Content-Type'] = 'application/json';
    const opts = { method, headers };
    if (body) opts.body = isForm ? body : JSON.stringify(body);

    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (err) {
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi jaringan.');
    }

    if (res.status === 401) {
      clearToken();
      window.location.href = 'ruangtv-login.html';
      throw new Error('Sesi habis, silakan login kembali');
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server mengembalikan respons tidak valid (HTTP ${res.status})`);
    }

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const get  = path => req('GET', path);
  const post = (path, body) => req('POST', path, body);
  const put  = (path, body) => req('PUT', path, body);
  const del  = path => req('DELETE', path);
  const form = (path, fd) => req('POST', path, fd, true);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const login = async (username, password) => {
    let res;
    try {
      res = await fetch(BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('Tidak dapat terhubung ke server. Pastikan server berjalan.');
    }

    let data;
    try { data = await res.json(); } catch { throw new Error('Respons server tidak valid'); }

    if (res.status === 429) throw new Error('Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.');
    if (!res.ok) throw new Error(data.error || 'Login gagal');

    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => { clearToken(); window.location.href = 'ruangtv-login.html'; };

  // ── API modules ────────────────────────────────────────────────────────────
  const branches = {
    list: () => get('/branches'),
    get: code => get(`/branches/${code}`),
    create: d => post('/branches', d),
    update: (code, d) => put(`/branches/${code}`, d),
    delete: code => del(`/branches/${code}`),
    tvKey: code => get(`/branches/${code}/tv-key`),
  };

  const contents = {
    list: (p = {}) => get('/contents' + (Object.keys(p).length ? '?' + new URLSearchParams(p) : '')),
    get: id => get(`/contents/${id}`),
    upload: fd => form('/contents/upload', fd),
    create: d => post('/contents', d),
    update: (id, d) => put(`/contents/${id}`, d),
    publish: id => post(`/contents/${id}/publish`),
    unpublish: id => post(`/contents/${id}/unpublish`),
    delete: id => del(`/contents/${id}`),
  };

  const schedules = {
    list: (p = {}) => get('/schedules' + (Object.keys(p).length ? '?' + new URLSearchParams(p) : '')),
    create: d => post('/schedules', d),
    update: (id, d) => put(`/schedules/${id}`, d),
    delete: id => del(`/schedules/${id}`),
  };

  const tv = {
    status: () => get('/tv/status'),
    push: (contentId, branchCodes) => post('/tv/push', { contentId, branchCodes }),
    pushPlaylist: code => post('/tv/push-playlist', { branchCode: code }),
    command: (code, command) => post('/tv/command', { branchCode: code, command }),
    playlist: code => get(`/tv/${code}/playlist`),
  };

  const stats = () => get('/stats');

  // ── WebSocket dengan Exponential Backoff ───────────────────────────────────
  let ws = null;
  let wsHandlers = {};
  let wsTimer = null;
  let wsRetryDelay = 1000;       // mulai dari 1 detik
  const WS_MAX_DELAY = 30000;    // maksimal 30 detik
  let wsManualClose = false;

  const connectWS = () => {
    const token = getToken();
    if (!token || wsManualClose) return;

    try {
      ws = new WebSocket(`${WS_BASE}/ws?type=ho&token=${token}`);
    } catch (e) {
      console.warn('WebSocket gagal dibuat:', e.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('✓ WebSocket HO terhubung');
      wsRetryDelay = 1000; // reset delay setelah berhasil
      if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
      wsHandlers['open']?.();
    };

    ws.onmessage = e => {
      try {
        const m = JSON.parse(e.data);
        wsHandlers[m.type]?.(m);
        wsHandlers['*']?.(m);
      } catch {}
    };

    ws.onclose = (event) => {
      wsHandlers['close']?.(event);
      if (!wsManualClose) {
        scheduleReconnect();
      }
    };

    ws.onerror = (err) => {
      wsHandlers['error']?.(err);
    };
  };

  const scheduleReconnect = () => {
    if (wsTimer) clearTimeout(wsTimer);
    wsTimer = setTimeout(() => {
      wsRetryDelay = Math.min(wsRetryDelay * 2, WS_MAX_DELAY);
      connectWS();
    }, wsRetryDelay);
  };

  const disconnectWS = () => {
    wsManualClose = true;
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
    if (ws) { ws.close(); ws = null; }
  };

  const onWS = (type, fn) => { wsHandlers[type] = fn; };

  // ── Toast notifications ────────────────────────────────────────────────────
  const toast = (msg, type = 'success', duration = 3500) => {
    const el = document.createElement('div');
    el.className = `rtv-toast rtv-toast-${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    el.innerHTML = `<span class="rtv-toast-icon">${icons[type] || 'ℹ'}</span><span class="rtv-toast-msg">${msg}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, duration);
  };

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmt = {
    fileSize: b => {
      if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
      if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
      return Math.round(b / 1024) + ' KB';
    },
    date: s => s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    time: s => s ? new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—',
    status: s => ({ live: 'Live', draft: 'Draft', scheduled: 'Terjadwal', online: 'Online', offline: 'Offline' })[s] || s,
    category: c => ({ promo: 'Promo', discount: 'Diskon', menu: 'Menu', info: 'Info' })[c] || c,
    duration: s => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`,
  };

  // ── Inject toast CSS ───────────────────────────────────────────────────────
  if (!document.getElementById('rtv-css')) {
    const s = document.createElement('style');
    s.id = 'rtv-css';
    s.textContent = `
      .rtv-toast {
        position: fixed; bottom: 24px; right: 24px; z-index: 9999;
        display: flex; align-items: center; gap: 10px;
        padding: 12px 20px; border-radius: 10px;
        font-size: 14px; font-weight: 500;
        box-shadow: 0 8px 32px rgba(0,0,0,.4);
        transform: translateY(20px); opacity: 0;
        transition: all .35s cubic-bezier(.34,1.56,.64,1);
        max-width: 380px; pointer-events: none;
        font-family: 'DM Sans', 'Inter', sans-serif;
      }
      .rtv-toast.show { transform: translateY(0); opacity: 1; pointer-events: auto; }
      .rtv-toast-icon { font-size: 16px; flex-shrink: 0; }
      .rtv-toast-success { background: #111; border: 1px solid rgba(34,197,94,.3); color: #22C55E; }
      .rtv-toast-error   { background: #111; border: 1px solid rgba(239,68,68,.3); color: #EF4444; }
      .rtv-toast-info    { background: #111; border: 1px solid rgba(255,203,5,.3); color: #FFCB05; }
      .rtv-toast-warning { background: #111; border: 1px solid rgba(245,158,11,.3); color: #F59E0B; }
    `;
    document.head.appendChild(s);
  }

  return {
    login, logout,
    getToken, getUser, requireAuth,
    branches, contents, schedules, tv, stats,
    connectWS, disconnectWS, onWS,
    toast, fmt,
    // Expose base URL untuk debugging
    get serverUrl() { return BASE_URL; },
  };
})();
