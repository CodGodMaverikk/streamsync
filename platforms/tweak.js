'use strict';

const { io } = require('socket.io-client');

// Connects to the Tweak Socket.io server and listens for chat messages
// Requires TWEAK_URL and TWEAK_STREAM_ID in .env

module.exports = {
  id: 'tweak',
  name: 'Tweak',
  color: '#0ea5e9',
  envKey: 'TWEAK_STREAM_ID',

  async connect(streamId, onMessage, log) {
    const tweakUrl = process.env.TWEAK_URL || 'https://tweak.mavops.org';

    const socket = io(tweakUrl, { path: '/socket.io', transports: ['websocket'] });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('Tweak connect timeout')), 10000);
    });

    socket.emit('join-stream', { streamId, username: null });
    log(`Chat bridge: Tweak stream ${streamId} connected`);

    socket.on('chat-message', (msg) => {
      // Ignore system messages from the raid/spotlight system
      if (msg.user?.username === 'System') return;
      onMessage({
        platform: 'tweak',
        username: msg.user?.displayName || msg.user?.username || 'Unknown',
        usernameColor: '#0ea5e9',
        message: msg.content,
      });
    });

    socket.on('disconnect', () => log('Chat bridge: Tweak disconnected'));

    return () => {
      socket.emit('leave-stream', streamId);
      socket.disconnect();
    };
  },
};
