const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('../config');
const mediasoupManager = require('./mediasoupManager');
const matchmaker = require('./matchmaker');

const app = express();
app.use(cors());
app.use(express.json());

// Explicitly grant Camera and Microphone permissions in HTTP headers
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self "*"), microphone=(self "*"), display-capture=(self "*")');
  next();
});

// Serve static web app assets
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

function getActiveUserCount() {
  let count = 0;
  if (io && io.sockets && io.sockets.sockets) {
    for (const [_, s] of io.sockets.sockets) {
      if (s.connected && !s.disconnected) {
        count++;
      }
    }
  }
  return count;
}

function broadcastUserCount() {
  setTimeout(() => {
    const count = getActiveUserCount();
    console.log(`[Socket.io] Broadcasting online users count: ${count}`);
    io.emit('userCount', { count: Math.max(1, count) });
  }, 80);
}

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  broadcastUserCount();

  // 1. User requests to find a random partner (Omegle style)
  socket.on('findMatch', () => {
    matchmaker.enqueueUser(socket, io);
    matchmaker.matchUsers(io);
  });

  // 2. Next / Skip partner
  socket.on('nextPartner', () => {
    console.log(`[Socket.io] User ${socket.id} requested next partner`);
    matchmaker.leaveRoom(socket, io);
    matchmaker.enqueueUser(socket, io);
    matchmaker.matchUsers(io);
  });

  // 3. WebRTC Signaling Relay
  socket.on('signal', ({ to, signal }) => {
    if (to) {
      io.to(to).emit('signal', { from: socket.id, signal });
    }
  });

  // Media State Toggle Relay (Camera/Mic on/off)
  socket.on('mediaStateChange', ({ videoEnabled, audioEnabled }) => {
    const partnerId = matchmaker.getPartnerId(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerMediaState', { videoEnabled, audioEnabled });
    }
  });

  // In-Call Chat Messaging Relay
  socket.on('chatMessage', ({ text }) => {
    const partnerId = matchmaker.getPartnerId(socket.id);
    if (partnerId && typeof text === 'string') {
      const trimmed = text.trim().slice(0, 1000);
      if (trimmed.length > 0) {
        io.to(partnerId).emit('chatMessage', {
          from: socket.id,
          text: trimmed,
          timestamp: Date.now()
        });
      }
    }
  });

  // In-Call Typing Status Relay
  socket.on('typing', ({ isTyping }) => {
    const partnerId = matchmaker.getPartnerId(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partnerTyping', { isTyping: Boolean(isTyping) });
    }
  });

  // 4. Get Mediasoup Router RTP Capabilities
  socket.on('getRouterRtpCapabilities', async (data, callback) => {
    try {
      const roomId = matchmaker.getRoomId(socket.id);
      if (!roomId) return callback({ error: 'No active room' });

      const router = await mediasoupManager.createRouter(roomId);
      callback({ rtpCapabilities: router.rtpCapabilities });
    } catch (err) {
      console.error('getRouterRtpCapabilities error:', err);
      callback({ error: err.message });
    }
  });

  // 5. Create WebRTC Transport
  socket.on('createWebRtcTransport', async (data, callback) => {
    try {
      const roomId = matchmaker.getRoomId(socket.id);
      if (!roomId) return callback({ error: 'No active room' });

      const transportOptions = await mediasoupManager.createWebRtcTransport(roomId);
      callback(transportOptions);
    } catch (err) {
      console.error('createWebRtcTransport error:', err);
      callback({ error: err.message });
    }
  });

  // 6. Connect WebRTC Transport
  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      await mediasoupManager.connectTransport(transportId, dtlsParameters);
      callback({ status: 'success' });
    } catch (err) {
      console.error('connectTransport error:', err);
      callback({ error: err.message });
    }
  });

  // 7. Produce Media Track
  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      const { id } = await mediasoupManager.produce(transportId, kind, rtpParameters);
      callback({ id });

      const partnerId = matchmaker.getPartnerId(socket.id);
      if (partnerId) {
        io.to(partnerId).emit('newProducer', { producerId: id, kind });
      }
    } catch (err) {
      console.error('produce error:', err);
      callback({ error: err.message });
    }
  });

  // 8. Consume Media Track
  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
    try {
      const roomId = matchmaker.getRoomId(socket.id);
      if (!roomId) return callback({ error: 'No active room' });

      const consumerParams = await mediasoupManager.consume(roomId, transportId, producerId, rtpCapabilities);
      callback(consumerParams);
    } catch (err) {
      console.error('consume error:', err);
      callback({ error: err.message });
    }
  });

  // 9. Disconnect handling
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    matchmaker.leaveRoom(socket, io);
    broadcastUserCount();
  });
});

async function main() {
  await mediasoupManager.init();
  server.listen(config.listenPort, () => {
    console.log(`====================================================`);
    console.log(`🚀 Mediasoup SFU Video Match Server running on port ${config.listenPort}`);
    console.log(`====================================================`);
  });
}

main().catch((err) => {
  console.error('Failed to start Mediasoup server:', err);
});
