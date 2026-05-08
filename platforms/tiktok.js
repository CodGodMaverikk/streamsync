'use strict';

let WebcastPushConnection;
try { WebcastPushConnection = require('tiktok-live-connector').WebcastPushConnection; } catch {}

module.exports = {
  id: 'tiktok',
  name: 'TikTok',
  color: '#69C9D0',
  envKey: 'TIKTOK_USERNAME',

  async connect(username, onMessage, log) {
    if (!WebcastPushConnection) throw new Error('tiktok-live-connector not installed');

    const client = new WebcastPushConnection(username);
    await client.connect();
    log(`Chat bridge: TikTok @${username} connected`);

    client.on('chat', (data) => {
      onMessage({
        platform: 'tiktok',
        username: data.nickname || data.uniqueId,
        usernameColor: '#69C9D0',
        message: data.comment,
      });
    });

    client.on('disconnected', (reason) => log(`Chat bridge: TikTok disconnected — ${reason}`));

    return () => { try { client.disconnect(); } catch {} };
  },
};
