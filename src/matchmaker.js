const mediasoupManager = require('./mediasoupManager');

class Matchmaker {
  constructor() {
    this.waitingQueue = []; // array of socket IDs
    this.activeRooms = new Map(); // roomId -> { peerA: socketId, peerB: socketId }
    this.userRooms = new Map(); // socketId -> roomId
    this.recentPartners = new Map(); // socketId -> Set of recent partner socket IDs
  }

  enqueueUser(socket, io = null) {
    if (!socket || !socket.id) return;

    // 1. Leave any active room cleanly first
    this.leaveRoom(socket, io);

    // 2. Remove duplicate occurrences from waiting queue
    this.removeFromQueue(socket.id);

    // 3. Add to waiting queue
    console.log(`[Matchmaker] Enqueuing user: ${socket.id}`);
    this.waitingQueue.push(socket.id);
  }

  removeFromQueue(socketId) {
    this.waitingQueue = this.waitingQueue.filter((id) => id !== socketId);
  }

  matchUsers(io) {
    // Sanity check: clean queue of dead/disconnected socket IDs
    this.waitingQueue = this.waitingQueue.filter((id) => io.sockets.sockets.has(id));

    while (this.waitingQueue.length >= 2) {
      const peerA = this.waitingQueue[0];
      let partnerIndex = -1;
      const peerARecents = this.recentPartners.get(peerA) || new Set();

      for (let i = 1; i < this.waitingQueue.length; i++) {
        const candidate = this.waitingQueue[i];
        if (candidate !== peerA) {
          if (partnerIndex === -1 || (!peerARecents.has(candidate) && this.waitingQueue.length > 2)) {
            partnerIndex = i;
            if (!peerARecents.has(candidate)) break;
          }
        }
      }

      if (partnerIndex === -1) {
        // No valid non-self partner found
        this.waitingQueue.shift();
        continue;
      }

      const peerB = this.waitingQueue[partnerIndex];

      // Remove peerB (at partnerIndex) and peerA (at index 0) from queue
      this.waitingQueue.splice(partnerIndex, 1);
      this.waitingQueue.shift();

      if (peerA === peerB) continue;

      // Track recent partners
      this.addRecentPartner(peerA, peerB);
      this.addRecentPartner(peerB, peerA);

      const roomId = `room_${peerA}_${peerB}_${Date.now()}`;
      this.activeRooms.set(roomId, { peerA, peerB });
      this.userRooms.set(peerA, roomId);
      this.userRooms.set(peerB, roomId);

      console.log(`[Matchmaker] Successfully matched ${peerA} <---> ${peerB} in ${roomId}`);

      // Notify both sockets
      io.to(peerA).emit('matched', { roomId, partnerId: peerB, isInitiator: true });
      io.to(peerB).emit('matched', { roomId, partnerId: peerA, isInitiator: false });
    }
  }

  addRecentPartner(user, partner) {
    if (!this.recentPartners.has(user)) {
      this.recentPartners.set(user, new Set());
    }
    const recents = this.recentPartners.get(user);
    recents.add(partner);
    if (recents.size > 5) {
      const first = recents.values().next().value;
      recents.delete(first);
    }
  }

  leaveRoom(socket, io = null) {
    if (!socket || !socket.id) return;

    this.removeFromQueue(socket.id);

    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    const room = this.activeRooms.get(roomId);
    if (room) {
      const partnerId = room.peerA === socket.id ? room.peerB : room.peerA;

      this.activeRooms.delete(roomId);
      mediasoupManager.closeRoom(roomId);

      if (io && partnerId) {
        console.log(`[Matchmaker] Partner ${partnerId} notified that ${socket.id} left`);
        io.to(partnerId).emit('partnerLeft', { message: 'Your partner has disconnected.' });

        // Re-enqueue partner automatically
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          this.userRooms.delete(partnerId);
          this.removeFromQueue(partnerId);
          this.waitingQueue.push(partnerId);
        }
      }
    }

    this.userRooms.delete(socket.id);
  }

  getRoomId(socketId) {
    return this.userRooms.get(socketId);
  }

  getPartnerId(socketId) {
    const roomId = this.userRooms.get(socketId);
    if (!roomId) return null;
    const room = this.activeRooms.get(roomId);
    if (!room) return null;
    return room.peerA === socketId ? room.peerB : room.peerA;
  }
}

module.exports = new Matchmaker();
