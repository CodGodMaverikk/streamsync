'use strict';

require('dotenv').config();
const NodeMediaServer = require('node-media-server');
const { spawn } = require('child_process');
const express = require('express');
const path = require('path');

// ─── Platform registry ───────────────────────────────────────────────────────
// Each platform: rtmp base URL + stream key (from env) + enabled toggle
const platforms = {
  tweak: {
    name: 'Tweak',
    color: '#0ea5e9',
    rtmpUrl: process.env.TWEAK_RTMP_URL || 'rtmp://global-live.mux.com:5222/app',
    key: process.env.TWEAK_STREAM_KEY || '',
    enabled: process.env.TWEAK_ENABLED !== 'false',
  },
  twitch: {
    name: 'Twitch',
    color: '#9147ff',
    rtmpUrl: process.env.TWITCH_RTMP_URL || 'rtmp://live.twitch.tv/app',
    key: process.env.TWITCH_STREAM_KEY || '',
    enabled: process.env.TWITCH_ENABLED !== 'false',
  },
  youtube: {
    name: 'YouTube',
    color: '#ff0000',
    rtmpUrl: process.env.YOUTUBE_RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2',
    key: process.env.YOUTUBE_STREAM_KEY || '',
    enabled: process.env.YOUTUBE_ENABLED !== 'false',
  },
  tiktok: {
    name: 'TikTok',
    color: '#010101',
    rtmpUrl: process.env.TIKTOK_RTMP_URL || 'rtmp://rtmp-push.tiktok.com/live',
    key: process.env.TIKTOK_STREAM_KEY || '',
    enabled: process.env.TIKTOK_ENABLED !== 'false',
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

  // Build ffmpeg args: one -c copy -f flv <url> block per platform
  const args = ['-re', '-i', inputUrl];
  for (const [, p] of active) {
    args.push('-c', 'copy', '-f', 'flv', `${p.rtmpUrl}/${p.key}`);
  }

  relayProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  relayStatus.active = true;
  relayStatus.startedAt = new Date().toISOString();
  relayStatus.platforms = active.map(([id]) => id);

  relayProcess.stderr.on('data', (chunk) => {
    // ffmpeg writes progress to stderr — only log lines that aren't pure progress
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
    if (err.code === 'ENOENT') {
      log('ERROR: ffmpeg not found — install it: apt install ffmpeg');
    }
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
  logType: 0, // suppress NMS internal logs — we handle our own
});

// Fires when OBS connects and starts sending video
nms.on('postPublish', (id, streamPath) => {
  const streamName = streamPath.split('/').pop();
  log(`Stream connected: ${streamPath}`);
  startRelay(streamName);
});

// Fires when OBS disconnects
nms.on('donePublish', (id, streamPath) => {
  log(`Stream disconnected: ${streamPath}`);
  stopRelay();
});

nms.run();
log(`RTMP ingest listening on port ${process.env.RTMP_PORT || 1935}`);

// ─── Express dashboard ────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    relay: relayStatus,
    platforms: Object.entries(platforms).map(([id, p]) => ({
      id,
      name: p.name,
      color: p.color,
      enabled: p.enabled,
      configured: !!p.key,
    })),
  });
});

// Toggle a platform on/off at runtime
app.post('/api/platforms/:id/toggle', (req, res) => {
  const { id } = req.params;
  if (!platforms[id]) return res.status(404).json({ error: 'Unknown platform' });
  platforms[id].enabled = !platforms[id].enabled;
  log(`${platforms[id].name} ${platforms[id].enabled ? 'enabled' : 'disabled'}`);
  res.json({ id, enabled: platforms[id].enabled });
});

// Force-stop relay (emergency)
app.post('/api/relay/stop', (req, res) => {
  stopRelay();
  res.json({ ok: true });
});

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '3001');
app.listen(DASHBOARD_PORT, () => {
  log(`Dashboard at http://localhost:${DASHBOARD_PORT}`);
});
