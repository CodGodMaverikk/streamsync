'use strict';

const tmi = require('tmi.js');

module.exports = {
  id: 'twitch',
  name: 'Twitch',
  color: '#9147ff',
  envKey: 'TWITCH_CHANNEL',

  async connect(username, onMessage, log) {
    const client = new tmi.Client({ channels: [username] });
    await client.connect();
    log(`Chat bridge: Twitch #${username} connected`);

    client.on('message', (channel, tags, message) => {
      onMessage({
        platform: 'twitch',
        username: tags['display-name'] || tags.username,
        usernameColor: tags.color || '#9147ff',
        message,
      });
    });

    return () => client.disconnect().catch(() => {});
  },
};
