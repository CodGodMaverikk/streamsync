'use strict';

const WebSocket = require('ws');

// Kick uses Pusher internally — we connect directly via their websocket
const PUSHER_KEY = '32cbd69e4b950bf97679';
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.4.0`;

// Kick's API is Cloudflare-protected — use browser headers.
// If KICK_CHATROOM_ID is set in .env, we skip the API call entirely.
async function getChatroomId(username) {
  if (process.env.KICK_CHATROOM_ID) return parseInt(process.env.KICK_CHATROOM_ID);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://kick.com/',
    'Origin': 'https://kick.com',
  };

  // Try v2 first, fall back to v1
  for (const url of [
    `https://kick.com/api/v2/channels/${username}`,
    `https://kick.com/api/v1/channels/${username}`,
  ]) {
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const data = await res.json();
    const id = data?.chatroom?.id;
    if (id) return id;
  }

  throw new Error(`Kick API blocked (403). Set KICK_CHATROOM_ID in .env to bypass. Get it from: https://kick.com/api/v2/channels/${username}`);
}

module.exports = {
  id: 'kick',
  name: 'Kick',
  color: '#53FC18',
  envKey: 'KICK_CHANNEL',

  async connect(username, onMessage, log) {
    const chatroomId = await getChatroomId(username);
    log(`Chat bridge: Kick chatroom ${chatroomId} (${username})`);

    const ws = new WebSocket(PUSHER_URL);
    let pingInterval;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: `chatrooms.${chatroomId}.v2` },
      }));
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
      }, 30000);
      log(`Chat bridge: Kick #${username} connected`);
    });

    ws.on('message', (raw) => {
      try {
        const { event, data } = JSON.parse(raw);
        if (event !== 'App\\Events\\ChatMessageEvent') return;
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        onMessage({
          platform: 'kick',
          username: msg.sender?.username || 'Unknown',
          usernameColor: msg.sender?.identity?.color || '#53FC18',
          message: msg.content,
        });
      } catch {}
    });

    ws.on('error', (err) => log(`Chat bridge: Kick error — ${err.message}`));
    ws.on('close', () => {
      clearInterval(pingInterval);
      log('Chat bridge: Kick disconnected');
    });

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  },
};
