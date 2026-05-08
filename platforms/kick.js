'use strict';

const WebSocket = require('ws');

// Kick uses Pusher internally — we connect directly via their websocket
const PUSHER_KEY = '32cbd69e4b950bf97679';
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=streamsync&version=1.0`;

async function getChatroomId(username) {
  const res = await fetch(`https://kick.com/api/v2/channels/${username}`);
  if (!res.ok) throw new Error(`Kick API returned ${res.status} for channel "${username}"`);
  const data = await res.json();
  const id = data?.chatroom?.id;
  if (!id) throw new Error(`Could not find chatroom ID for Kick channel "${username}"`);
  return id;
}

module.exports = {
  id: 'kick',
  name: 'Kick',
  color: '#53FC18',
  envKey: 'KICK_CHANNEL',

  async connect(username, onMessage, log) {
    const chatroomId = await getChatroomId(username);
    log(`Chat bridge: Kick chatroom ID ${chatroomId} for ${username}`);

    const ws = new WebSocket(PUSHER_URL);
    let pingInterval;

    ws.on('open', () => {
      // Subscribe to the chatroom channel
      ws.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: `chatrooms.${chatroomId}.v2` },
      }));
      // Pusher requires periodic pings
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
