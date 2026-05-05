FROM node:22-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# RTMP ingest port
EXPOSE 1935
# Dashboard
EXPOSE 3001

CMD ["node", "server.js"]
