const { WebSocketServer, WebSocket } = require('ws');
const { generateTvKey } = require('./auth');
const { run, get } = require('./database');

// Map: branchCode -> WebSocket connection
const tvConnections = new Map();
// Map: branchCode -> last heartbeat timestamp
const lastHeartbeat = new Map();

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const branchCode = url.searchParams.get('branch');
    const tvKey = url.searchParams.get('key');

    // Validate TV key
    if (!branchCode || !tvKey) {
      ws.close(4001, 'Missing branch or key');
      return;
    }

    const expectedKey = generateTvKey(branchCode);
    if (tvKey !== expectedKey) {
      ws.close(4002, 'Invalid TV key');
      return;
    }

    // Register connection
    tvConnections.set(branchCode, ws);
    lastHeartbeat.set(branchCode, Date.now());

    // Update branch status to online
    try {
      run(`UPDATE branches SET status='online', last_seen=datetime('now','localtime') WHERE code=?`, [branchCode]);
    } catch (e) {
      console.error('DB update error:', e.message);
    }

    console.log(`📺 TV connected: ${branchCode} (total: ${tvConnections.size})`);

    // Send welcome + current schedule
    sendToTv(branchCode, {
      type: 'CONNECTED',
      branchCode,
      message: `Terhubung ke RuangTV HO — ${branchCode}`,
      timestamp: new Date().toISOString(),
    });

    // Push current active content for this branch
    pushCurrentContent(branchCode);

    // Handle messages from TV
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleTvMessage(branchCode, msg);
      } catch (e) {
        console.error(`Message parse error from ${branchCode}:`, e.message);
      }
    });

    ws.on('close', () => {
      tvConnections.delete(branchCode);
      lastHeartbeat.delete(branchCode);
      try {
        run(`UPDATE branches SET status='offline' WHERE code=?`, [branchCode]);
      } catch (e) {}
      console.log(`📺 TV disconnected: ${branchCode} (total: ${tvConnections.size})`);
      broadcastToHO({ type: 'TV_OFFLINE', branchCode, timestamp: new Date().toISOString() });
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error ${branchCode}:`, err.message);
    });

    // Notify HO dashboards
    broadcastToHO({ type: 'TV_ONLINE', branchCode, timestamp: new Date().toISOString() });
  });

  // Heartbeat check every 30 seconds
  setInterval(() => {
    const now = Date.now();
    tvConnections.forEach((ws, branchCode) => {
      const last = lastHeartbeat.get(branchCode) || 0;
      if (now - last > 60000) {
        // No heartbeat for 60s — close
        ws.terminate();
        tvConnections.delete(branchCode);
        try {
          run(`UPDATE branches SET status='offline' WHERE code=?`, [branchCode]);
        } catch (e) {}
      } else {
        // Send ping
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }
    });
  }, 30000);

  console.log('✓ WebSocket server initialized at /ws');
  return wss;
}

function handleTvMessage(branchCode, msg) {
  switch (msg.type) {
    case 'HEARTBEAT':
      lastHeartbeat.set(branchCode, Date.now());
      try {
        run(`UPDATE branches SET last_seen=datetime('now','localtime') WHERE code=?`, [branchCode]);
      } catch (e) {}
      sendToTv(branchCode, { type: 'HEARTBEAT_ACK', timestamp: new Date().toISOString() });
      break;

    case 'CONTENT_PLAYING':
      console.log(`▶ ${branchCode} playing: ${msg.contentName}`);
      broadcastToHO({ type: 'CONTENT_PLAYING', branchCode, contentId: msg.contentId, contentName: msg.contentName });
      break;

    case 'CONTENT_ERROR':
      console.warn(`⚠ ${branchCode} content error: ${msg.error}`);
      broadcastToHO({ type: 'CONTENT_ERROR', branchCode, error: msg.error });
      break;

    case 'TV_INFO':
      broadcastToHO({ type: 'TV_INFO', branchCode, info: msg });
      break;

    default:
      console.log(`Unknown message from ${branchCode}:`, msg.type);
  }
}

// ── HO Dashboard connections (for live status feed) ─────────────────────────
const hoConnections = new Set();

function registerHO(ws) {
  hoConnections.add(ws);
  ws.on('close', () => hoConnections.delete(ws));
  // Send current TV statuses
  ws.send(JSON.stringify({
    type: 'STATUS_SNAPSHOT',
    onlineBranches: Array.from(tvConnections.keys()),
    timestamp: new Date().toISOString(),
  }));
}

function broadcastToHO(message) {
  const payload = JSON.stringify(message);
  hoConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

// ── Push content to specific TV or all TVs ───────────────────────────────────
function sendToTv(branchCode, message) {
  const ws = tvConnections.get(branchCode);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function pushContentToTv(branchCode, contentData) {
  return sendToTv(branchCode, {
    type: 'PUSH_CONTENT',
    content: contentData,
    timestamp: new Date().toISOString(),
  });
}

function pushContentToAll(contentData, targetBranches = null) {
  const results = {};
  const targets = targetBranches || Array.from(tvConnections.keys());
  targets.forEach(code => {
    results[code] = pushContentToTv(code, contentData);
  });
  return results;
}

function pushCurrentContent(branchCode) {
  // Push all currently live content for this branch
  try {
    const { query } = require('./database');
    const allLive = query(`SELECT * FROM contents WHERE status = 'live' ORDER BY id ASC`);
    const liveContents = allLive.filter(c => {
      const t = (c.targets || 'ALL').toUpperCase().trim();
      if (t === 'ALL' || t === '') return true;
      return t.split(',').map(x => x.trim()).filter(Boolean).includes(branchCode.toUpperCase());
    });

    if (liveContents.length > 0) {
      sendToTv(branchCode, {
        type: 'PLAYLIST_UPDATE',
        playlist: liveContents,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('pushCurrentContent error:', e.message);
  }
}

function getOnlineBranches() {
  return Array.from(tvConnections.keys());
}

function isTvOnline(branchCode) {
  const ws = tvConnections.get(branchCode);
  return ws && ws.readyState === WebSocket.OPEN;
}

module.exports = {
  initWebSocket,
  sendToTv,
  pushContentToTv,
  pushContentToAll,
  broadcastToHO,
  registerHO,
  getOnlineBranches,
  isTvOnline,
};
