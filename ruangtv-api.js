// ============================================================
//  RuangTV — API Client & Auth Layer v2.0
//  Include di semua halaman: <script src="ruangtv-api.js"></script>
// ============================================================
const API = (() => {
  // ── Auto-detect server URL (no more hardcoded localhost!) ──────────────────
  const BASE_URL = window.RUANGTV_API_URL || window.location.origin;
  const BASE = BASE_URL + '/api';

  const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_HOST = (window.RUANGTV_WS_URL || window.location.host);
  const WS_BASE = `${WS_PROTOCOL}//${WS_HOST}`;

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

  const req = async (method, path, body = null, isForm = false) => {
    const headers = { Authorization: `Bearer ${getToken()}` };
    if (!isForm) headers['Content-Type'] = 'application/json';
    const opts = { method, headers };
    if (body) opts.body = isForm ? body : JSON.stringify(body);

    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch {
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi jaringan.');
    }

    if (res.status === 401) { clearToken(); window.location.href = 'ruangtv-login.html'; throw new Error('Sesi habis'); }

    let data;
    try { data = await res.json(); } catch { throw new Error(`Respons tidak valid (HTTP ${res.status})`); }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const get  = path => req('GET', path);
  const post = (path, body) => req('POST', path, body);
  const put  = (path, body) => req('PUT', path, body);
  const del  = path => req('DELETE', path);
  const form = (path, fd) => req('POST', path, fd, true);

  const login = async (username, password) => {
    let res;
    try {
      res = await fetch(BASE + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch { throw new Error('Tidak dapat terhubung ke server.'); }

    let data;
    try { data = await res.json(); } catch { throw new Error('Respons server tidak valid'); }
    if (res.status === 429) throw new Error('Terlalu banyak percobaan login. Coba lagi nanti.');
    if (!res.ok) throw new Error(data.error || 'Login gagal');
    setToken(data.token); setUser(data.user);
    return data;
  };

  const logout = () => { clearToken(); window.location.href = 'ruangtv-login.html'; };

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

  // WebSocket dengan Exponential Backoff
  let ws = null, wsHandlers = {}, wsTimer = null;
  let wsRetryDelay = 1000, wsManualClose = false;

  const connectWS = () => {
    const token = getToken();
    if (!token || wsManualClose) return;
    try { ws = new WebSocket(`${WS_BASE}/ws?type=ho&token=${token}`); } catch { scheduleReconnect(); return; }
    ws.onopen = () => { wsRetryDelay = 1000; if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } wsHandlers['open']?.(); };
    ws.onmessage = e => { try { const m = JSON.parse(e.data); wsHandlers[m.type]?.(m); wsHandlers['*']?.(m); } catch {} };
    ws.onclose = (ev) => { wsHandlers['close']?.(ev); if (!wsManualClose) scheduleReconnect(); };
    ws.onerror = err => wsHandlers['error']?.(err);
  };

  const scheduleReconnect = () => {
    if (wsTimer) clearTimeout(wsTimer);
    wsTimer = setTimeout(() => { wsRetryDelay = Math.min(wsRetryDelay * 2, 30000); connectWS(); }, wsRetryDelay);
  };

  const disconnectWS = () => {
    wsManualClose = true;
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
    if (ws) { ws.close(); ws = null; }
  };

  const onWS = (type, fn) => { wsHandlers[type] = fn; };

  const toast = (msg, type = 'success', duration = 3500) => {
    const el = document.createElement('div');
    el.className = `rtv-toast rtv-toast-${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, duration);
  };

  const fmt = {
    fileSize: b => b >= 1073741824 ? (b/1073741824).toFixed(1)+' GB' : b >= 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.round(b/1024)+' KB',
    date: s => s ? new Date(s).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '—',
    time: s => s ? new Date(s).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) : '—',
    status: s => ({live:'Live',draft:'Draft',scheduled:'Terjadwal',online:'Online',offline:'Offline'})[s] || s,
    category: c => ({promo:'Promo',discount:'Diskon',menu:'Menu',info:'Info'})[c] || c,
    duration: s => s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`,
  };

  if (!document.getElementById('rtv-css')) {
    const s = document.createElement('style'); s.id = 'rtv-css';
    s.textContent = `.rtv-toast{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,.4);transform:translateY(20px);opacity:0;transition:all .35s cubic-bezier(.34,1.56,.64,1);max-width:380px;font-family:'DM Sans','Inter',sans-serif;}.rtv-toast.show{transform:translateY(0);opacity:1;}.rtv-toast-success{background:#111;border:1px solid rgba(34,197,94,.3);color:#22C55E;}.rtv-toast-error{background:#111;border:1px solid rgba(239,68,68,.3);color:#EF4444;}.rtv-toast-info{background:#111;border:1px solid rgba(255,203,5,.3);color:#FFCB05;}.rtv-toast-warning{background:#111;border:1px solid rgba(245,158,11,.3);color:#F59E0B;}`;
    document.head.appendChild(s);
  }

  return { login, logout, getToken, getUser, requireAuth, branches, contents, schedules, tv, stats, connectWS, disconnectWS, onWS, toast, fmt, get serverUrl() { return BASE_URL; } };
})();
