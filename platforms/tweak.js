'use strict';

const { io } = require('socket.io-client');

// Connects to the Tweak Socket.io server and listens for chat messages.
// Uses TWEAK_USERNAME to look up the current active stream room dynamically —
// stream IDs change every session (new CUID per stream), so we can't use a static ID.

module.exports = {
  id: 'tweak',
  name: 'Tweak',
  color: '#0ea5e9',
  envKey: 'TWEAK_USERNAME',

  async connect(username, onMessage, log) {
    const tweakUrl = process.env.TWEAK_URL || 'https://tweak.mavops.org';

    async function fetchStreamId() {
      try {
        const res = await fetch(`${tweakUrl}/api/streams/active?username=${encodeURIComponent(username)}`);
        if (res.ok) {
          const { streamId } = await res.json();
          return streamId;
        }
      } catch {}
      return null;
    }

    const socket = io(tweakUrl, { path: '/socket.io', transports: ['websocket'] });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('Tweak connect timeout')), 10000);
    });

    // Initial join — Mux webhook may not have fired yet so this might be the user ID fallback
    let currentStreamId = await fetchStreamId();
    if (!currentStreamId) throw new Error('Could not resolve Tweak stream ID for ' + username);

    socket.emit('join-stream', { streamId: currentStreamId, username: null });
    log(`Chat bridge: Tweak ${username} connected (room: ${currentStreamId})`);

    // After 20s the Mux webhook will have fired and the Stream record will exist.
    // Re-fetch and join the correct room (joining again is additive — no disconnect needed).
    const recheckTimer = setTimeout(async () => {
      const newId = await fetchStreamId();
      if (newId && newId !== currentStreamId) {
        log(`Chat bridge: Tweak room updated → ${newId}`);
        socket.emit('join-stream', { streamId: newId, username: null });
        currentStreamId = newId;
      }
    }, 20000);

    socket.on('chat-message', (msg) => {
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
      clearTimeout(recheckTimer);
      socket.disconnect();
    };
  },
};
