'use strict';

require('dotenv').config();
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const fs = require('fs');
const chatBridge = require('./chat-bridge');

// ─── Persist runtime config (keys + enabled state) ───────────────────────────
const CONFIG_FILE = path.join(__dirname, 'runtime-config.json');

function loadRuntimeConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveRuntimeConfig() {
  const out = {};
  for (const [id, p] of Object.entries(platforms)) {
    out[id] = { key: p.key, enabled: p.enabled };
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2));
}

// ─── Platform registry ───────────────────────────────────────────────────────
const saved = loadRuntimeConfig();
const firstRun = Object.keys(saved).length === 0;

const platforms = {
  tweak: {
    name: 'Tweak',
    color: '#0ea5e9',
    rtmpUrl: process.env.TWEAK_RTMP_URL || 'rtmp://global-live.mux.com:5222/app',
    key:     saved.tweak?.key     ?? process.env.TWEAK_STREAM_KEY  ?? '',
    enabled: saved.tweak?.enabled ?? process.env.TWEAK_ENABLED !== 'false',
  },
  twitch: {
    name: 'Twitch',
    color: '#9147ff',
    rtmpUrl: process.env.TWITCH_RTMP_URL || 'rtmp://live.twitch.tv/app',
    key:     saved.twitch?.key     ?? process.env.TWITCH_STREAM_KEY ?? '',
    enabled: saved.twitch?.enabled ?? process.env.TWITCH_ENABLED !== 'false',
  },
  youtube: {
    name: 'YouTube',
    color: '#ff0000',
    rtmpUrl: process.env.YOUTUBE_RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2',
    key:     saved.youtube?.key     ?? process.env.YOUTUBE_STREAM_KEY ?? '',
    enabled: saved.youtube?.enabled ?? process.env.YOUTUBE_ENABLED !== 'false',
  },
  tiktok: {
    name: 'TikTok',
    color: '#69C9D0',
    rtmpUrl: process.env.TIKTOK_RTMP_URL || 'rtmp://rtmp-push.tiktok.com/live',
    key:     saved.tiktok?.key     ?? process.env.TIKTOK_STREAM_KEY ?? '',
    enabled: saved.tiktok?.enabled ?? process.env.TIKTOK_ENABLED !== 'false',
  },
  kick: {
    name: 'Kick',
    color: '#53FC18',
    rtmpUrl: process.env.KICK_RTMP_URL || 'rtmp://fa723fc1b171.global-contribute.live-video.net/app',
    key:     saved.kick?.key     ?? process.env.KICK_STREAM_KEY ?? '',
    enabled: saved.kick?.enabled ?? process.env.KICK_ENABLED !== 'false',
  },
};

// ─── State ───────────────────────────────────────────────────────────────────
let relayProcess = null;
const relayStatus = {
  active: false,
  startedAt: null,
  platforms: [],
  logs: [],
};

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  relayStatus.logs.push(line);
  if (relayStatus.logs.length > 200) relayStatus.logs.shift();
}

// ─── Relay logic ─────────────────────────────────────────────────────────────
function startRelay(streamName) {
  if (relayProcess) stopRelay();

  const active = Object.entries(platforms).filter(([, p]) => p.enabled && p.key);
  if (active.length === 0) {
    log('No platforms enabled/configured — relay skipped');
    return;
  }

  const inputUrl = `rtmp://127.0.0.1:1935/live/${streamName}`;
  log(`Starting relay for stream: ${streamName}`);
  log(`Targets: ${active.map(([, p]) => p.name).join(', ')}`);

  // No -re flag for live RTMP — that's only for file inputs
  const args = ['-i', inputUrl];
  for (const [, p] of active) {
    args.push('-c', 'copy', '-f', 'flv', `${p.rtmpUrl}/${p.key}`);
  }

  relayProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  relayStatus.active = true;
  relayStatus.startedAt = new Date().toISOString();
  relayStatus.platforms = active.map(([id]) => id);

  relayProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && !line.startsWith('frame=')) log(line.slice(0, 120));
  });

  relayProcess.on('close', (code) => {
    log(`FFmpeg exited with code ${code}`);
    relayProcess = null;
    relayStatus.active = false;
    relayStatus.startedAt = null;
    relayStatus.platforms = [];
  });

  relayProcess.on('error', (err) => {
    log(`FFmpeg error: ${err.message}`);
    if (err.code === 'ENOENT') log('ERROR: ffmpeg not found — install it: apt install ffmpeg');
    relayStatus.active = false;
  });
}

function stopRelay() {
  if (relayProcess) {
    log('Stopping relay');
    relayProcess.kill('SIGTERM');
    relayProcess = null;
  }
  relayStatus.active = false;
  relayStatus.startedAt = null;
  relayStatus.platforms = [];
}

// ─── Node-Media-Server (RTMP ingest) ─────────────────────────────────────────
const nms = new NodeMediaServer({
  rtmp: {
    port: parseInt(process.env.RTMP_PORT || '1935'),
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  logType: 0,
});

nms.on('postPublish', (id, streamPath) => {
  const streamName = streamPath.split('/').pop();
  log(`Stream connected: ${streamPath}`);
  startRelay(streamName);
  chatBridge.start(log);
});

nms.on('donePublish', (id, streamPath) => {
  log(`Stream disconnected: ${streamPath}`);
  stopRelay();
  chatBridge.stop(log);
});

// Seed runtime config from env vars on first run so dashboard shows correct state
if (firstRun) saveRuntimeConfig();

nms.run();
log(`RTMP ingest listening on port ${process.env.RTMP_PORT || 1935}`);

// ─── Dashboard auth middleware ────────────────────────────────────────────────
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

function requireAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next(); // no password set — open access
  const auth = req.headers['authorization'] || '';
  const [, encoded] = auth.split(' ');
  if (!encoded) return res.set('WWW-Authenticate', 'Basic realm="StreamSync"').status(401).send('Unauthorized');
  const [, password] = Buffer.from(encoded, 'base64').toString().split(':');
  if (password !== DASHBOARD_PASSWORD) return res.set('WWW-Authenticate', 'Basic realm="StreamSync"').status(401).send('Unauthorized');
  next();
}

// ─── Express dashboard ────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Status
app.get('/api/status', (req, res) => {
  res.json({
    relay: relayStatus,
    platforms: Object.entries(platforms).map(([id, p]) => ({
      id,
      name: p.name,
      color: p.color,
      enabled: p.enabled,
      configured: !!p.key,
      // never send the actual key to the frontend
    })),
  });
});

// Toggle enabled/disabled
app.post('/api/platforms/:id/toggle', (req, res) => {
  const { id } = req.params;
  if (!platforms[id]) return res.status(404).json({ error: 'Unknown platform' });
  platforms[id].enabled = !platforms[id].enabled;
  saveRuntimeConfig();
  log(`${platforms[id].name} ${platforms[id].enabled ? 'enabled' : 'disabled'}`);
  res.json({ id, enabled: platforms[id].enabled });
});

// Update stream key
app.post('/api/platforms/:id/key', (req, res) => {
  const { id } = req.params;
  const { key } = req.body;
  if (!platforms[id]) return res.status(404).json({ error: 'Unknown platform' });
  if (typeof key !== 'string') return res.status(400).json({ error: 'key must be a string' });
  platforms[id].key = key.trim();
  saveRuntimeConfig();
  log(`${platforms[id].name} stream key updated`);
  res.json({ id, configured: !!platforms[id].key });
});

// Force-stop relay
app.post('/api/relay/stop', (req, res) => {
  stopRelay();
  chatBridge.stop(log);
  res.json({ ok: true });
});

// Unified chat SSE stream
app.get('/api/chat', chatBridge.sseHandler);

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '3001');
app.listen(DASHBOARD_PORT, () => {
  log(`Dashboard at http://localhost:${DASHBOARD_PORT}`);
  if (!DASHBOARD_PASSWORD) log('WARNING: No DASHBOARD_PASSWORD set — dashboard is unprotected');
});
