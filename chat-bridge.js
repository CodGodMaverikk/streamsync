'use strict';

const PLATFORMS = [
  require('./platforms/tweak'),
  require('./platforms/twitch'),
  require('./platforms/kick'),
  require('./platforms/tiktok'),
  require('./platforms/youtube'),
];

// SSE clients — each is an Express res object
const sseClients = new Set();

// Cleanup functions returned by each platform's connect()
const disconnectors = new Map();

let msgId = 0;

function broadcast(msg) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ id: ++msgId, ts: Date.now(), ...msg })}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

// ─── Start all configured platforms ──────────────────────────────────────────
async function start(log) {
  for (const platform of PLATFORMS) {
    const value = process.env[platform.envKey];
    if (!value) continue; // not configured — skip silently

    if (disconnectors.has(platform.id)) continue; // already connected

    try {
      const disconnect = await platform.connect(value, (msg) => broadcast(msg), log);
      disconnectors.set(platform.id, disconnect);
    } catch (err) {
      log(`Chat bridge: ${platform.name} failed — ${err.message}`);
    }
  }
}

// ─── Stop all platforms ───────────────────────────────────────────────────────
async function stop(log) {
  for (const [id, disconnect] of disconnectors) {
    try { await disconnect(); } catch {}
    disconnectors.delete(id);
  }
  log('Chat bridge: all platforms disconnected');
}

// ─── SSE middleware ───────────────────────────────────────────────────────────
function sseHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  sseClients.add(res);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
}

module.exports = { start, stop, sseHandler };
