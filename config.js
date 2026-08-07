const os = require('os');

module.exports = {
  // HTTP server options
  listenIp: '0.0.0.0',
  listenPort: process.env.PORT || 3000,

  // Mediasoup worker settings
  mediasoup: {
    numWorkers: Math.min(2, Math.max(1, os.cpus().length)),
    workerSettings: {
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp'
      ],
      rtcMinPort: 10000,
      rtcMaxPort: 10100
    },

    // Router media codecs
    routerOptions: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1
          }
        }
      ]
    },

    // WebRtcTransport settings
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1'
        }
      ],
      initialAvailableOutgoingBitrate: 1000000,
      maxSdpMangledOfferDataLength: 24600
    }
  }
};
