const mediasoup = require('mediasoup');
const config = require('../config');

class MediasoupManager {
  constructor() {
    this.workers = [];
    this.nextWorkerIdx = 0;
    this.routers = new Map(); // roomId -> router
    this.transports = new Map(); // transportId -> transport
    this.producers = new Map(); // producerId -> producer
    this.consumers = new Map(); // consumerId -> consumer
  }

  async init() {
    const { numWorkers, workerSettings } = config.mediasoup;
    console.log(`[Mediasoup] Initializing ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker(workerSettings);

      worker.on('died', (error) => {
        console.error(`[Mediasoup] Worker died [pid:${worker.pid}]`, error);
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push(worker);
    }
    console.log(`[Mediasoup] Successfully initialized ${this.workers.length} worker(s).`);
  }

  getNextWorker() {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  async createRouter(roomId) {
    if (this.routers.has(roomId)) {
      return this.routers.get(roomId);
    }
    const worker = this.getNextWorker();
    const router = await worker.createRouter(config.mediasoup.routerOptions);
    this.routers.set(roomId, router);
    console.log(`[Mediasoup] Router created for room: ${roomId}`);
    return router;
  }

  getRouter(roomId) {
    return this.routers.get(roomId);
  }

  async createWebRtcTransport(roomId) {
    const router = await this.createRouter(roomId);
    const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransportOptions);

    this.transports.set(transport.id, transport);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
        this.transports.delete(transport.id);
      }
    });

    transport.on('@close', () => {
      this.transports.delete(transport.id);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    };
  }

  async connectTransport(transportId, dtlsParameters) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);
    await transport.connect({ dtlsParameters });
  }

  async produce(transportId, kind, rtpParameters) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({ kind, rtpParameters });
    this.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      producer.close();
      this.producers.delete(producer.id);
    });

    return { id: producer.id };
  }

  async consume(roomId, transportId, producerId, rtpCapabilities) {
    const router = this.getRouter(roomId);
    if (!router) throw new Error(`Router for room ${roomId} not found`);

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`Cannot consume producer ${producerId}`);
    }

    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      consumer.close();
      this.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      consumer.close();
      this.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    };
  }

  closeRoom(roomId) {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
      console.log(`[Mediasoup] Room ${roomId} closed.`);
    }
  }
}

module.exports = new MediasoupManager();
