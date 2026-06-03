// ============================================================
//  RuangTV — API Client & Auth Layer v1.0
//  Include di semua halaman: <script src="ruangtv-api.js"></script>
// ============================================================
const API = (() => {
  const BASE = 'https://ruangtv.up.railway.app/api';
  const WS_BASE = 'wss://ruangtv.up.railway.app/ws';

  const getToken = () => localStorage.getItem('ruangtv_token');
  const setToken = t => localStorage.setItem('ruangtv_token', t);
  const clearToken = () => { localStorage.removeItem('ruangtv_token'); localStorage.removeItem('ruangtv_user'); };
  const getUser = () => { try { return JSON.parse(localStorage.getItem('ruangtv_user')); } catch { return null; } };
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
    const res = await fetch(BASE + path, opts);
    if (res.status === 401) { clearToken(); window.location.href = 'ruangtv-login.html'; throw new Error('Sesi habis'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const get  = path => req('GET', path);
  const post = (path, body) => req('POST', path, body);
  const put  = (path, body) => req('PUT', path, body);
  const del  = path => req('DELETE', path);
  const form = (path, fd) => req('POST', path, fd, true);

  const login = async (username, password) => {
    const res = await fetch(BASE + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
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

  // WebSocket
  let ws = null, wsHandlers = {}, wsTimer = null;
  const connectWS = () => {
    const token = getToken(); if (!token) return;
    try { ws = new WebSocket(`${WS_BASE}?type=ho&token=${token}`); } catch { return; }
    ws.onopen = () => { if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; } wsHandlers['open']?.(); };
    ws.onmessage = e => { try { const m = JSON.parse(e.data); wsHandlers[m.type]?.(m); wsHandlers['*']?.(m); } catch {} };
    ws.onclose = () => { wsHandlers['close']?.(); wsTimer = setTimeout(connectWS, 5000); };
  };
  const onWS = (type, fn) => { wsHandlers[type] = fn; };

  // Toast
  const toast = (msg, type = 'success') => {
    const el = document.createElement('div');
    el.className = `rtv-toast rtv-toast-${type}`;
    el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
  };

  const fmt = {
    fileSize: b => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.round(b/1024)+' KB',
    date: s => s ? new Date(s).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '—',
    status: s => ({live:'Live',draft:'Draft',scheduled:'Terjadwal',online:'Online',offline:'Offline'})[s] || s,
    category: c => ({promo:'Promo',discount:'Diskon',menu:'Menu',info:'Info'})[c] || c,
  };

  // Inject toast CSS
  if (!document.getElementById('rtv-css')) {
    const s = document.createElement('style'); s.id = 'rtv-css';
    s.textContent = `.rtv-toast{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,.4);transform:translateY(20px);opacity:0;transition:all .3s cubic-bezier(.34,1.56,.64,1);max-width:360px;}.rtv-toast.show{transform:translateY(0);opacity:1;}.rtv-toast-success{background:#111;border:1px solid rgba(34,197,94,.3);color:#22C55E;}.rtv-toast-error{background:#111;border:1px solid rgba(239,68,68,.3);color:#EF4444;}.rtv-toast-info{background:#111;border:1px solid rgba(255,203,5,.3);color:#FFCB05;}`;
    document.head.appendChild(s);
  }

  return { login, logout, getToken, getUser, requireAuth, branches, contents, schedules, tv, stats, connectWS, onWS, toast, fmt };
})();
