'use strict';

// YouTube Live Chat via Data API v3 (polling — no websocket available)
// Requires YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID in .env

const POLL_INTERVAL = 8000; // ms between polls (API quota: 10k units/day, each poll ~5 units)

async function getLiveChatId(channelId, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channelId}&type=video&eventType=live&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const videoId = data.items?.[0]?.id?.videoId;
  if (!videoId) throw new Error('No active YouTube live stream found for this channel');

  const vidUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`;
  const vidRes = await fetch(vidUrl);
  const vidData = await vidRes.json();
  const chatId = vidData.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!chatId) throw new Error('Could not get liveChatId from YouTube video');
  return chatId;
}

module.exports = {
  id: 'youtube',
  name: 'YouTube',
  color: '#FF0000',
  envKey: 'YOUTUBE_CHANNEL_ID',

  async connect(channelId, onMessage, log) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error('YOUTUBE_API_KEY not set');

    const chatId = await getLiveChatId(channelId, apiKey);
    log(`Chat bridge: YouTube live chat connected (chatId: ${chatId})`);

    let pageToken = null;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${chatId}&part=snippet,authorDetails&key=${apiKey}`;
        if (pageToken) url += `&pageToken=${pageToken}`;

        const res = await fetch(url);
        const data = await res.json();
        if (data.error) { log(`Chat bridge: YouTube API error — ${data.error.message}`); return; }

        pageToken = data.nextPageToken;
        for (const item of data.items || []) {
          const text = item.snippet?.displayMessage;
          const author = item.authorDetails?.displayName;
          if (text && author) {
            onMessage({
              platform: 'youtube',
              username: author,
              usernameColor: '#FF0000',
              message: text,
            });
          }
        }
      } catch (err) {
        log(`Chat bridge: YouTube poll error — ${err.message}`);
      }
      if (!stopped) setTimeout(poll, POLL_INTERVAL);
    }

    // First poll after a short delay to let the stream start
    setTimeout(poll, 3000);

    return () => { stopped = true; log('Chat bridge: YouTube disconnected'); };
  },
};
