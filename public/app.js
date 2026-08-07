const socket = io();

// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const remotePlaceholder = document.getElementById('remotePlaceholder');
const placeholderText = document.getElementById('placeholderText');
const partnerTag = document.getElementById('partnerTag');
const onlineCount = document.getElementById('onlineCount');
const localCamOff = document.getElementById('localCamOff');
const remoteCamOff = document.getElementById('remoteCamOff');
const placeholderHeading = document.getElementById('placeholderHeading');
const viewport = document.querySelector('.viewport');

let localStream = null;
let peerConnection = null;
let currentPartnerId = null;
let pendingCandidates = [];
let micEnabled = true;
let camEnabled = true;

// WebRTC Configuration with STUN Servers
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' }
  ]
};

// Initialize Camera & Microphone with Mobile & Desktop Fallbacks
async function initLocalMedia() {
  if (localStream) return localStream;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('[Media Error] Camera permission requires HTTPS or Localhost on mobile browsers!');
    alert('⚠️ कैमरा सुरक्षा नियम:\n\nमोबाइल फ़ोन पर कैमरा एक्सेस करने के लिए HTTPS कनेक्शन या Localhost आवश्यक है।\n\n(Camera permission requires HTTPS connection on mobile browsers. If testing over IP, please use HTTPS or VS Code DevTunnels/ngrok).');
    return null;
  }

  // Mobile & Desktop friendly video constraint list
  const constraintOptions = [
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: true },
    { video: { facingMode: 'user' }, audio: true },
    { video: true, audio: true }
  ];

  for (const constraints of constraintOptions) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[Media] Successfully obtained local stream with constraints:', constraints);
      break;
    } catch (err) {
      console.warn('[Media] Constraint attempt failed, trying fallback...', err);
    }
  }

  if (localStream) {
    localVideo.srcObject = localStream;
    localVideo.play().catch((e) => console.log('Local video play error:', e));
    return localStream;
  } else {
    alert('Please allow Camera and Microphone permissions to start video chat.');
    return null;
  }
}

// Auto init local media on page load
initLocalMedia();

// Update UI Status Badge
function setStatus(state, message) {
  if (statusBadge) statusBadge.className = 'status-badge ' + state;
  if (statusText) statusText.textContent = message;
}

// Socket Events
socket.on('connect', () => {
  console.log('Connected to signaling server:', socket.id);
  setStatus('idle', 'Ready');
});

socket.on('userCount', ({ count }) => {
  if (onlineCount) {
    onlineCount.textContent = `${count} Online`;
  }
});

socket.on('matched', async ({ roomId, partnerId, isInitiator }) => {
  console.log(`Matched in room ${roomId} with partner ${partnerId}, initiator: ${isInitiator}`);
  setStatus('connected', 'Connected');
  if (viewport) viewport.classList.remove('searching');
  nextBtn.disabled = false;
  startBtn.disabled = true;

  await setupPeerConnection(partnerId, isInitiator);
});

socket.on('partnerLeft', ({ message }) => {
  console.log('Partner left:', message);
  cleanupPeerConnection();
  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = 'Searching for partner...';
  placeholderText.textContent = 'Please wait! Connecting you to a new person...';
  remotePlaceholder.style.display = 'flex';
  partnerTag.style.display = 'none';
});

// Signaling Messages Handling
socket.on('signal', async ({ from, signal }) => {
  if (!peerConnection || (currentPartnerId && from !== currentPartnerId)) {
    console.warn('Ignoring signal from non-matched partner:', from);
    return;
  }

  try {
    if (signal.sdp) {
      console.log('Received SDP signal:', signal.sdp.type, 'from:', from);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      // Process buffered ICE candidates
      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.warn('Error adding buffered candidate:', e);
        }
      }

      if (signal.sdp.type === 'offer') {
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { to: from, signal: { sdp: peerConnection.localDescription } });
      }
    } else if (signal.candidate) {
      const candidate = new RTCIceCandidate(signal.candidate);
      if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        await peerConnection.addIceCandidate(candidate);
      } else {
        pendingCandidates.push(candidate);
      }
    }
  } catch (err) {
    console.error('Error handling signal:', err);
  }
});

// PeerConnection Handler for Mobile & Desktop Video Streaming
async function setupPeerConnection(partnerId, isInitiator) {
  cleanupPeerConnection();
  currentPartnerId = partnerId;
  pendingCandidates = [];

  // Ensure local media is ready before adding tracks
  await initLocalMedia();

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Add local audio and video tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle Incoming Remote Audio & Video Tracks
  peerConnection.ontrack = (event) => {
    console.log('[ontrack] Received remote track:', event.track.kind, event.streams);

    let stream = remoteVideo.srcObject;
    if (!stream || !(stream instanceof MediaStream)) {
      stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream();
      remoteVideo.srcObject = stream;
    }

    if (!stream.getTracks().includes(event.track)) {
      stream.addTrack(event.track);
    }

    // Hide waiting placeholder and display partner tag
    remotePlaceholder.style.display = 'none';
    partnerTag.style.display = 'flex';

    // Play video with autoplay error handling fallback for mobile devices
    const playPromise = remoteVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Autoplay blocked on mobile, muting video temporarily to force play:', err);
        remoteVideo.muted = true;
        remoteVideo.play().then(() => {
          remoteVideo.muted = false; // Unmute after play starts
        }).catch((e) => console.error('Play failed after mute retry:', e));
      });
    }
  };

  // Send local ICE candidates to remote partner
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentPartnerId === partnerId) {
      socket.emit('signal', {
        to: partnerId,
        signal: { candidate: event.candidate }
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE Connection State:', peerConnection ? peerConnection.iceConnectionState : 'closed');
  };

  // If initiator, create and send SDP offer
  if (isInitiator) {
    try {
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await peerConnection.setLocalDescription(offer);
      socket.emit('signal', {
        to: partnerId,
        signal: { sdp: peerConnection.localDescription }
      });
    } catch (err) {
      console.error('Error creating SDP offer:', err);
    }
  }
}

function cleanupPeerConnection() {
  currentPartnerId = null;
  pendingCandidates = [];

  if (remoteCamOff) {
    remoteCamOff.style.display = 'none';
  }

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
}

// Button Listeners
startBtn.addEventListener('click', async () => {
  cleanupPeerConnection();
  await initLocalMedia();

  // Unmute remoteVideo on user tap if autoplay was muted
  if (remoteVideo) remoteVideo.muted = false;

  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = 'Searching for partner...';
  placeholderText.textContent = 'Finding an online partner...';
  remotePlaceholder.style.display = 'flex';
  startBtn.disabled = true;
  nextBtn.disabled = false;
  socket.emit('findMatch');
});

nextBtn.addEventListener('click', async () => {
  cleanupPeerConnection();
  await initLocalMedia();

  if (remoteVideo) remoteVideo.muted = false;

  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = 'Searching for next match...';
  placeholderText.textContent = 'Switching partner... Connecting now!';
  remotePlaceholder.style.display = 'flex';
  partnerTag.style.display = 'none';
  socket.emit('nextPartner');
});

socket.on('partnerMediaState', ({ videoEnabled, audioEnabled }) => {
  if (remoteCamOff) {
    remoteCamOff.style.display = videoEnabled ? 'none' : 'flex';
  }
});

// Mic & Cam Toggle Controls
micBtn.addEventListener('click', () => {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  micBtn.classList.toggle('off', !micEnabled);
  micBtn.querySelector('span').textContent = micEnabled ? '🎙️' : '🔇';
  socket.emit('mediaStateChange', { videoEnabled: camEnabled, audioEnabled: micEnabled });
});

camBtn.addEventListener('click', () => {
  if (!localStream) return;
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
  camBtn.classList.toggle('off', !camEnabled);
  camBtn.querySelector('span').textContent = camEnabled ? '📹' : '📷';

  if (localCamOff) {
    localCamOff.style.display = camEnabled ? 'none' : 'flex';
  }

  socket.emit('mediaStateChange', { videoEnabled: camEnabled, audioEnabled: micEnabled });
});

// PWA Service Worker & Install Prompt Logic
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[PWA] ServiceWorker registered:', reg.scope);
    }).catch((err) => {
      console.error('[PWA] ServiceWorker error:', err);
    });
  });
}

let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) {
    installBtn.style.display = 'flex';
  }
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
}
