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
const quickReactions = document.getElementById('quickReactions');
const reactionsContainer = document.getElementById('reactionsContainer');

// Permission Modal Elements
const permissionModal = document.getElementById('permissionModal');
const permissionModalTitle = document.getElementById('permissionModalTitle');
const permissionModalSubtitle = document.getElementById('permissionModalSubtitle');
const permissionErrorMsg = document.getElementById('permissionErrorMsg');
const retryPermissionBtn = document.getElementById('retryPermissionBtn');
const dismissPermissionBtn = document.getElementById('dismissPermissionBtn');
const closePermissionModal = document.getElementById('closePermissionModal');
const localCamPrompt = document.getElementById('localCamPrompt');
const inAppBrowserHint = document.getElementById('inAppBrowserHint');

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

// Floating Emoji Animation Generator
function triggerFloatingEmoji(emoji) {
  if (!reactionsContainer) return;
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  
  // Random horizontal position within 20% to 80%
  const randomLeft = 20 + Math.random() * 60;
  el.style.left = `${randomLeft}%`;
  
  reactionsContainer.appendChild(el);
  setTimeout(() => {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 2200);
}

// Attach Quick Emoji Reaction Button Listeners
if (quickReactions) {
  quickReactions.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      if (!emoji) return;
      triggerFloatingEmoji(emoji);

      if (currentPartnerId) {
        socket.emit('signal', { to: currentPartnerId, signal: { emoji } });
      }
    });
  });
}

// In-App Browser Detection
function isInAppBrowser() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  return /FBAN|FBAV|Instagram|Line|Twitter|MicroMessenger|Snapchat|Bytedance|TikTok/i.test(ua);
}

// Permission Modal Controls
function showPermissionModal({ title, subtitle, errorMsg } = {}) {
  if (permissionModalTitle && title) permissionModalTitle.textContent = title;
  if (permissionModalSubtitle && subtitle) permissionModalSubtitle.textContent = subtitle;
  if (permissionErrorMsg && errorMsg) permissionErrorMsg.textContent = errorMsg;
  if (inAppBrowserHint) {
    inAppBrowserHint.style.display = isInAppBrowser() ? 'flex' : 'none';
  }
  if (permissionModal) {
    permissionModal.style.display = 'flex';
  }
}

function hidePermissionModal() {
  if (permissionModal) {
    permissionModal.style.display = 'none';
  }
}

if (closePermissionModal) {
  closePermissionModal.addEventListener('click', hidePermissionModal);
}

if (dismissPermissionBtn) {
  dismissPermissionBtn.addEventListener('click', hidePermissionModal);
}

if (retryPermissionBtn) {
  retryPermissionBtn.addEventListener('click', async () => {
    hidePermissionModal();
    const stream = await initLocalMedia({ isUserAction: true });
    if (stream && startBtn && !startBtn.disabled) {
      startBtn.click();
    }
  });
}

if (permissionModal) {
  permissionModal.addEventListener('click', (e) => {
    if (e.target === permissionModal) {
      hidePermissionModal();
    }
  });
}

if (localCamPrompt) {
  localCamPrompt.addEventListener('click', () => {
    initLocalMedia({ isUserAction: true });
  });
}

let isRequestingMedia = false;

// Initialize Camera & Microphone with Mobile & Desktop Fallbacks
async function initLocalMedia(options = {}) {
  const { isUserAction = false, isPageLoad = false } = options;

  if (localStream) return localStream;
  if (isRequestingMedia) return null;

  isRequestingMedia = true;

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('[Media Error] getUserMedia is not supported in this browser or requires HTTPS.');
      if (localCamPrompt) localCamPrompt.style.display = 'flex';
      if (isUserAction) {
        showPermissionModal({
          title: 'HTTPS / Browser Support Required',
          subtitle: 'Camera & Microphone access requires a secure HTTPS connection.',
          errorMsg: 'Liveza requires HTTPS and modern browser support. If you are inside an in-app browser (Instagram/Facebook/etc.), please tap ⋮ in top right and choose "Open in Chrome" or "Open in Safari".'
        });
      }
      return null;
    }

    // Comprehensive Fallback Constraint Tiers:
    // Tier 1: User-facing video (ideal resolution) + audio
    // Tier 2: Basic user-facing video + audio
    // Tier 3: Standard video + audio
    // Tier 4: Video only (e.g. desktop with webcam but no microphone)
    // Tier 5: Audio only (e.g. laptop/desktop with microphone but no webcam)
    const constraintTiers = [
      {
        name: 'Video (HD) & Audio',
        constraints: {
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true
        }
      },
      {
        name: 'Video & Audio (Basic)',
        constraints: {
          video: { facingMode: 'user' },
          audio: true
        }
      },
      {
        name: 'Video & Audio (Standard)',
        constraints: {
          video: true,
          audio: true
        }
      },
      {
        name: 'Video Only',
        constraints: {
          video: true,
          audio: false
        }
      },
      {
        name: 'Audio Only',
        constraints: {
          video: false,
          audio: true
        }
      }
    ];

    let lastError = null;

    for (const tier of constraintTiers) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia(tier.constraints);
        console.log(`[Media] Successfully obtained stream via: ${tier.name}`);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[Media] Tier "${tier.name}" failed:`, err.name, err.message);
      }
    }

    if (localStream) {
      localVideo.srcObject = localStream;
      localVideo.play().catch((e) => console.log('Local video play error:', e));

      const videoTracks = localStream.getVideoTracks();
      const audioTracks = localStream.getAudioTracks();

      if (videoTracks.length === 0) {
        camEnabled = false;
        if (camBtn) camBtn.classList.add('off');
        if (localCamOff) localCamOff.style.display = 'flex';
      } else {
        camEnabled = true;
        if (camBtn) camBtn.classList.remove('off');
        if (localCamOff) localCamOff.style.display = 'none';
      }

      if (audioTracks.length === 0) {
        micEnabled = false;
        if (micBtn) micBtn.classList.add('off');
      } else {
        micEnabled = true;
        if (micBtn) micBtn.classList.remove('off');
      }

      if (localCamPrompt) localCamPrompt.style.display = 'none';
      hidePermissionModal();
      return localStream;
    } else {
      console.error('[Media] All media constraint tiers failed:', lastError);
      if (localCamPrompt) localCamPrompt.style.display = 'flex';

      // Do NOT show blocking alerts or modal on silent page load!
      // Only show permission modal if user explicitly clicked a button
      if (isUserAction) {
        let title = 'Camera & Microphone Access Required';
        let subtitle = 'Liveza needs permission to stream your video and audio.';
        let msg = 'Camera and Microphone permissions were blocked in your browser.';

        if (lastError) {
          if (lastError.name === 'NotAllowedError' || lastError.name === 'PermissionDeniedError') {
            title = 'Permission Blocked in Browser';
            subtitle = 'Camera or Microphone access was denied in your browser settings.';
            msg = 'Please click the lock (🔒) or site settings (🎛️) icon next to chat.liveza.fun in the address bar and switch Camera & Microphone to "Allow".';
          } else if (lastError.name === 'NotFoundError' || lastError.name === 'DevicesNotFoundError') {
            title = 'Camera / Mic Not Detected';
            subtitle = 'No camera or microphone was found on this device.';
            msg = 'Please connect a webcam or microphone/headset and click "Allow / Try Again".';
          } else if (lastError.name === 'NotReadableError' || lastError.name === 'TrackStartError') {
            title = 'Camera / Mic In Use';
            subtitle = 'Your camera or microphone is in use by another application.';
            msg = 'Please close any other app using your camera (Zoom, Teams, Skype, or other tabs) and click "Allow / Try Again".';
          } else if (lastError.name === 'OverconstrainedError') {
            title = 'Camera Resolution Not Supported';
            subtitle = 'Your camera does not support the requested video settings.';
            msg = 'Please click "Allow / Try Again" to connect with default settings.';
          }
        }

        showPermissionModal({
          title,
          subtitle,
          errorMsg: msg
        });
      }

      return null;
    }
  } finally {
    isRequestingMedia = false;
  }
}

// Auto init local media on page load SILENTLY (no blocking alerts!)
initLocalMedia({ isPageLoad: true, isUserAction: false });

// Update UI Status Badge
function setStatus(state, message) {
  if (statusBadge) statusBadge.className = 'status-badge ' + state;
  if (statusText) statusText.textContent = message;
}

// Socket Events
socket.on('connect', () => {
  console.log('Connected to Liveza server:', socket.id);
  setStatus('idle', 'Ready');
});

socket.on('userCount', ({ count }) => {
  if (onlineCount) {
    onlineCount.textContent = `${count} Online`;
  }
});

socket.on('matched', async ({ roomId, partnerId, isInitiator }) => {
  console.log(`Matched on Liveza in room ${roomId} with partner ${partnerId}, initiator: ${isInitiator}`);
  setStatus('connected', 'Connected');
  if (viewport) viewport.classList.remove('searching');
  nextBtn.disabled = false;
  startBtn.disabled = true;

  if (quickReactions) quickReactions.style.display = 'flex';

  await setupPeerConnection(partnerId, isInitiator);
});

socket.on('partnerLeft', ({ message }) => {
  console.log('Partner left:', message);
  cleanupPeerConnection();
  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = 'Searching Liveza network...';
  if (placeholderText) placeholderText.textContent = 'Connecting you to a new person worldwide...';
  remotePlaceholder.style.display = 'flex';
  partnerTag.style.display = 'none';
  if (quickReactions) quickReactions.style.display = 'none';
});

// Signaling Messages Handling
socket.on('signal', async ({ from, signal }) => {
  if (signal.emoji) {
    triggerFloatingEmoji(signal.emoji);
    return;
  }

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
  if (!localStream) {
    await initLocalMedia({ isUserAction: true });
  }

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
    if (quickReactions) quickReactions.style.display = 'flex';

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

  if (quickReactions) {
    quickReactions.style.display = 'none';
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

  // User click action guarantees browser permits permission request
  const stream = await initLocalMedia({ isUserAction: true });
  if (!stream) {
    // If user has not yet permitted or hardware unavailable, modal guides them
    return;
  }

  // Unmute remoteVideo on user tap if autoplay was muted
  if (remoteVideo) remoteVideo.muted = false;

  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = 'Searching Liveza partner...';
  if (placeholderText) placeholderText.textContent = 'Matching you with someone online right now!';
  remotePlaceholder.style.display = 'flex';
  startBtn.disabled = true;
  nextBtn.disabled = false;
  socket.emit('findMatch');
});

nextBtn.addEventListener('click', async () => {
  cleanupPeerConnection();

  if (!localStream) {
    const stream = await initLocalMedia({ isUserAction: true });
    if (!stream) return;
  }

  if (remoteVideo) remoteVideo.muted = false;

  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = 'Finding next match...';
  if (placeholderText) placeholderText.textContent = 'Switching partner... Connecting now!';
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
micBtn.addEventListener('click', async () => {
  if (!localStream) {
    await initLocalMedia({ isUserAction: true });
    return;
  }
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  micBtn.classList.toggle('off', !micEnabled);
  micBtn.querySelector('span').textContent = micEnabled ? '🎙️' : '🔇';
  socket.emit('mediaStateChange', { videoEnabled: camEnabled, audioEnabled: micEnabled });
});

camBtn.addEventListener('click', async () => {
  if (!localStream) {
    await initLocalMedia({ isUserAction: true });
    return;
  }
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
      console.log('[PWA] Liveza ServiceWorker registered:', reg.scope);
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

// Draggable Local Self Video PiP for Mobile & Desktop
function enableDraggablePiP(cardEl, containerEl) {
  if (!cardEl || !containerEl) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    isDragging = true;
    cardEl.classList.add('is-dragging');

    const cardRect = cardEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();

    startX = e.clientX;
    startY = e.clientY;
    initialLeft = cardRect.left - containerRect.left;
    initialTop = cardRect.top - containerRect.top;

    cardEl.style.left = `${initialLeft}px`;
    cardEl.style.top = `${initialTop}px`;
    cardEl.style.right = 'auto';
    cardEl.style.bottom = 'auto';

    try {
      cardEl.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const containerRect = containerEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const maxLeft = Math.max(8, containerRect.width - cardRect.width - 8);
    const maxTop = Math.max(8, containerRect.height - cardRect.height - 8);

    newLeft = Math.max(8, Math.min(newLeft, maxLeft));
    newTop = Math.max(8, Math.min(newTop, maxTop));

    cardEl.style.left = `${newLeft}px`;
    cardEl.style.top = `${newTop}px`;
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    cardEl.classList.remove('is-dragging');
    try {
      cardEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  cardEl.addEventListener('pointerdown', onPointerDown);
  cardEl.addEventListener('pointermove', onPointerMove);
  cardEl.addEventListener('pointerup', onPointerUp);
  cardEl.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => {
    if (cardEl.style.left && cardEl.style.left !== 'auto') {
      const containerRect = containerEl.getBoundingClientRect();
      const cardRect = cardEl.getBoundingClientRect();
      const curLeft = parseFloat(cardEl.style.left) || 0;
      const curTop = parseFloat(cardEl.style.top) || 0;
      const maxLeft = Math.max(8, containerRect.width - cardRect.width - 8);
      const maxTop = Math.max(8, containerRect.height - cardRect.height - 8);

      cardEl.style.left = `${Math.max(8, Math.min(curLeft, maxLeft))}px`;
      cardEl.style.top = `${Math.max(8, Math.min(curTop, maxTop))}px`;
    }
  });
}

const localCard = document.getElementById('localCard');
enableDraggablePiP(localCard, viewport);

