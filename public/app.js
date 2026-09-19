const socket = io();

// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteAudio = document.getElementById('remoteAudio');
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

// Disconnect Overlay Elements
const partnerDisconnectOverlay = document.getElementById('partnerDisconnectOverlay');
const disconnectCountdown = document.getElementById('disconnectCountdown');
const disconnectTimerPill = document.getElementById('disconnectTimerPill');
const disconnectNextBtn = document.getElementById('disconnectNextBtn');
const disconnectCancelBtn = document.getElementById('disconnectCancelBtn');

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
const unmuteSoundBtn = document.getElementById('unmuteSoundBtn');

if (unmuteSoundBtn) {
  unmuteSoundBtn.addEventListener('click', () => {
    if (remoteAudio) {
      remoteAudio.muted = false;
      remoteAudio.volume = 1.0;
      remoteAudio.play().catch((e) => console.log('Unmute audio error:', e));
    }
    if (remoteVideo) {
      remoteVideo.muted = false;
      remoteVideo.play().catch((e) => console.log('Unmute video error:', e));
    }
    unmuteSoundBtn.style.display = 'none';
  });
}

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentPartnerId = null;
let pendingCandidates = [];
let signalQueue = [];
let isPeerReady = false;
let isMakingOffer = false;
let micEnabled = true;
let camEnabled = true;
let disconnectTimer = null;
let countdownRemaining = 3;
let nextCooldownTimer = null;
let nextCooldownSeconds = 0;

// High-Availability WebRTC Configuration with Global STUN & Open TURN/TURNS Relays
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
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
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        }
      },
      {
        name: 'Video & Audio (Basic)',
        constraints: {
          video: { facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true }
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
          audio: { echoCancellation: true, noiseSuppression: true }
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

// 5-Second Cooldown on Next Button
function startNextCooldown() {
  clearNextCooldown();
  nextCooldownSeconds = 5;
  if (nextBtn) {
    nextBtn.disabled = true;
    nextBtn.classList.add('btn-cooldown');
    updateNextBtnDisplay();
  }

  nextCooldownTimer = setInterval(() => {
    nextCooldownSeconds -= 1;
    if (nextCooldownSeconds <= 0) {
      clearNextCooldown();
    } else {
      updateNextBtnDisplay();
    }
  }, 1000);
}

function updateNextBtnDisplay() {
  if (!nextBtn) return;
  const wordMain = nextBtn.querySelector('.btn-word-main');
  const wordSub = nextBtn.querySelector('.btn-word-sub');
  const keyHint = nextBtn.querySelector('.key-hint');
  if (wordMain) wordMain.textContent = `Wait (${nextCooldownSeconds}s)`;
  if (wordSub) wordSub.textContent = '';
  if (keyHint) keyHint.style.display = 'none';
}

function clearNextCooldown() {
  if (nextCooldownTimer) {
    clearInterval(nextCooldownTimer);
    nextCooldownTimer = null;
  }
  nextCooldownSeconds = 0;
  if (nextBtn) {
    nextBtn.disabled = false;
    nextBtn.classList.remove('btn-cooldown');
    const wordMain = nextBtn.querySelector('.btn-word-main');
    const wordSub = nextBtn.querySelector('.btn-word-sub');
    const keyHint = nextBtn.querySelector('.key-hint');
    if (wordMain) wordMain.textContent = 'Next';
    if (wordSub) wordSub.textContent = ' Partner';
    if (keyHint) keyHint.style.display = 'inline-block';
  }
}

// Prime Audio Playback on User Interaction
function primeAudioContext() {
  if (remoteAudio) {
    remoteAudio.play().catch(() => {});
  }
  if (remoteVideo) {
    remoteVideo.play().catch(() => {});
  }
}

function clearDisconnectTimer() {
  if (disconnectTimer) {
    clearInterval(disconnectTimer);
    disconnectTimer = null;
  }
}

function handlePartnerLeft() {
  console.log('[Liveza] Partner disconnected');
  clearDisconnectTimer();
  clearNextCooldown();
  cleanupPeerConnection();

  // Keep local stream & local video running smoothly!
  // Hide radar search placeholder so the page never looks like it refreshed/crashed
  if (remotePlaceholder) remotePlaceholder.style.display = 'none';
  if (viewport) viewport.classList.remove('searching');

  setStatus('idle', 'Partner Disconnected');
  if (startBtn) startBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = false;

  if (partnerDisconnectOverlay) {
    partnerDisconnectOverlay.style.display = 'flex';
    if (disconnectTimerPill) disconnectTimerPill.style.display = 'inline-flex';
    countdownRemaining = 3;
    if (disconnectCountdown) disconnectCountdown.textContent = countdownRemaining;

    clearDisconnectTimer();
    disconnectTimer = setInterval(() => {
      countdownRemaining -= 1;
      if (disconnectCountdown) disconnectCountdown.textContent = countdownRemaining;
      if (countdownRemaining <= 0) {
        clearDisconnectTimer();
        if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
        startFindingPartner(true);
      }
    }, 1000);
  }
}

async function startFindingPartner(isNext = false) {
  clearDisconnectTimer();
  clearNextCooldown();
  if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';

  cleanupPeerConnection();

  // Prime audio playback during user gesture to avoid browser autoplay blocks
  primeAudioContext();

  if (!localStream) {
    const stream = await initLocalMedia({ isUserAction: true });
    if (!stream) return;
  }

  if (remoteVideo) remoteVideo.muted = false;

  setStatus('searching', 'Searching...');
  if (viewport) viewport.classList.add('searching');
  if (placeholderHeading) placeholderHeading.textContent = isNext ? 'Finding next match...' : 'Searching Liveza partner...';
  if (placeholderText) placeholderText.textContent = isNext ? 'Switching partner... Connecting now!' : 'Matching you with someone online right now!';
  if (remotePlaceholder) remotePlaceholder.style.display = 'flex';
  if (partnerTag) partnerTag.style.display = 'none';

  if (startBtn) startBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = false;

  if (isNext) {
    socket.emit('nextPartner');
  } else {
    socket.emit('findMatch');
  }
}

// Disconnect Overlay Button Listeners
if (disconnectNextBtn) {
  disconnectNextBtn.addEventListener('click', () => {
    clearDisconnectTimer();
    if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
    startFindingPartner(true);
  });
}

if (disconnectCancelBtn) {
  disconnectCancelBtn.addEventListener('click', () => {
    clearDisconnectTimer();
    if (disconnectTimerPill) disconnectTimerPill.style.display = 'none';
    setStatus('idle', 'Disconnected');
  });
}

socket.on('matched', async ({ roomId, partnerId, isInitiator }) => {
  console.log(`Matched on Liveza in room ${roomId} with partner ${partnerId}, initiator: ${isInitiator}`);
  clearDisconnectTimer();
  if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
  setStatus('connected', 'Connected');
  if (viewport) viewport.classList.remove('searching');
  if (startBtn) startBtn.disabled = true;

  if (quickReactions) quickReactions.style.display = 'flex';

  // Start 5-second cooldown on next button to prevent spamming
  startNextCooldown();

  await setupPeerConnection(partnerId, isInitiator);
});

socket.on('partnerLeft', () => {
  handlePartnerLeft();
});

// Signaling Messages Handling with Buffered Queue & Collision Avoidance
socket.on('signal', async ({ from, signal }) => {
  if (signal.emoji) {
    triggerFloatingEmoji(signal.emoji);
    return;
  }

  if (currentPartnerId && from !== currentPartnerId) {
    console.warn('[WebRTC] Ignoring signal from mismatch partner:', from);
    return;
  }

  // If peer connection is initializing, buffer the signal so it is NEVER lost
  if (!peerConnection || !isPeerReady) {
    console.log('[WebRTC] Buffering signal because peerConnection is initializing:', signal.sdp ? signal.sdp.type : 'candidate');
    signalQueue.push({ from, signal });
    return;
  }

  await handleIncomingSignal(from, signal);
});

async function handleIncomingSignal(from, signal) {
  if (!peerConnection || (currentPartnerId && from !== currentPartnerId)) return;

  try {
    if (signal.sdp) {
      console.log('[WebRTC] Processing SDP:', signal.sdp.type, 'from:', from);
      const desc = new RTCSessionDescription(signal.sdp);

      if (desc.type === 'offer') {
        if (peerConnection.signalingState !== 'stable') {
          console.warn('[WebRTC] Handling offer collision rollback on state:', peerConnection.signalingState);
          await Promise.all([
            peerConnection.setLocalDescription({ type: 'rollback' }),
            peerConnection.setRemoteDescription(desc)
          ]);
        } else {
          await peerConnection.setRemoteDescription(desc);
        }

        // Flush buffered ICE candidates
        while (pendingCandidates.length > 0) {
          const candidate = pendingCandidates.shift();
          try {
            await peerConnection.addIceCandidate(candidate);
          } catch (e) {
            console.warn('[WebRTC] Error adding buffered candidate:', e);
          }
        }

        const answer = await peerConnection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { to: from, signal: { sdp: peerConnection.localDescription } });
      } else if (desc.type === 'answer') {
        if (peerConnection.signalingState === 'have-local-offer') {
          await peerConnection.setRemoteDescription(desc);

          while (pendingCandidates.length > 0) {
            const candidate = pendingCandidates.shift();
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (e) {
              console.warn('[WebRTC] Error adding buffered candidate:', e);
            }
          }
        } else {
          console.warn('[WebRTC] Ignoring unexpected answer in state:', peerConnection.signalingState);
        }
      }
    } else if (signal.candidate) {
      const candidate = new RTCIceCandidate(signal.candidate);
      if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.warn('[WebRTC] Error adding candidate:', e);
        }
      } else {
        pendingCandidates.push(candidate);
      }
    }
  } catch (err) {
    console.error('[WebRTC] Error handling signal:', err);
  }
}

// PeerConnection Handler for Mobile & Desktop Video/Audio Streaming
async function setupPeerConnection(partnerId, isInitiator) {
  clearDisconnectTimer();
  if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
  cleanupPeerConnection();

  currentPartnerId = partnerId;
  isPeerReady = false;
  pendingCandidates = [];
  signalQueue = [];

  // 1. Immediately create RTCPeerConnection instance
  peerConnection = new RTCPeerConnection(rtcConfig);

  // 2. Persistent remote MediaStream for video
  remoteStream = new MediaStream();
  if (remoteVideo) {
    remoteVideo.srcObject = remoteStream;
  }

  // 3. Add local audio and video tracks if already available
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      try {
        console.log(`[WebRTC] Adding local ${track.kind} track (enabled: ${track.enabled})`);
        peerConnection.addTrack(track, localStream);
      } catch (e) {
        console.warn('[WebRTC] Track add error:', e);
      }
    });
  }

  // 4. Handle Incoming Remote Audio & Video Tracks
  peerConnection.ontrack = (event) => {
    console.log('[ontrack] Received remote track:', event.track.kind);

    if (!remoteStream) {
      remoteStream = new MediaStream();
      if (remoteVideo) remoteVideo.srcObject = remoteStream;
    }

    // Always add track to remoteStream for video container
    if (!remoteStream.getTracks().includes(event.track)) {
      remoteStream.addTrack(event.track);
    }

    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((t) => {
        if (!remoteStream.getTracks().includes(t)) {
          remoteStream.addTrack(t);
        }
      });
    }

    // Dedicated Audio Handling: route directly to remoteAudio element
    if (event.track.kind === 'audio') {
      event.track.enabled = true;
      if (remoteAudio) {
        remoteAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
        remoteAudio.volume = 1.0;
        remoteAudio.muted = false;
        remoteAudio.play().then(() => {
          console.log('[WebRTC] Remote audio track playing through remoteAudio');
        }).catch((err) => {
          console.warn('[WebRTC] remoteAudio play error, showing unmute hint:', err);
          if (unmuteSoundBtn) unmuteSoundBtn.style.display = 'flex';
        });
      }
    }

    // Video Handling: reveal stage when video frame arrives
    if (event.track.kind === 'video') {
      event.track.onunmute = () => {
        console.log('[WebRTC] Remote video track unmuted (first frame received)');
        if (remotePlaceholder) remotePlaceholder.style.display = 'none';
        if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
        if (partnerTag) partnerTag.style.display = 'flex';
        if (quickReactions) quickReactions.style.display = 'flex';
      };
    }

    // Play video element
    if (remoteVideo) {
      const playPromise = remoteVideo.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Autoplay blocked video on mobile, muting video element (audio plays via remoteAudio):', err);
          remoteVideo.muted = true;
          remoteVideo.play().catch((e) => console.error('Video play retry failed:', e));
        });
      }
    }
  };

  // Video element playing event listener ensures placeholder hides when frames render
  if (remoteVideo) {
    remoteVideo.onplaying = () => {
      if (remotePlaceholder) remotePlaceholder.style.display = 'none';
      if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
      if (partnerTag) partnerTag.style.display = 'flex';
      if (quickReactions) quickReactions.style.display = 'flex';
    };
  }

  // 5. Send local ICE candidates to remote partner
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentPartnerId === partnerId) {
      socket.emit('signal', {
        to: partnerId,
        signal: { candidate: event.candidate }
      });
    }
  };

  // 6. Connection recovery & ICE restart
  peerConnection.oniceconnectionstatechange = async () => {
    const state = peerConnection ? peerConnection.iceConnectionState : 'closed';
    console.log('[WebRTC] ICE Connection State:', state);
    if ((state === 'failed' || state === 'disconnected') && isInitiator && currentPartnerId === partnerId) {
      console.log('[WebRTC] ICE state', state, 'attempting restart...');
      try {
        if (peerConnection.restartIce) {
          peerConnection.restartIce();
        }
        const offer = await peerConnection.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { to: partnerId, signal: { sdp: peerConnection.localDescription } });
      } catch (err) {
        console.warn('ICE restart error:', err);
      }
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection ? peerConnection.connectionState : 'closed';
    console.log('[WebRTC] Connection State:', state);
    if (state === 'connected') {
      if (remotePlaceholder) remotePlaceholder.style.display = 'none';
      if (partnerDisconnectOverlay) partnerDisconnectOverlay.style.display = 'none';
      if (partnerTag) partnerTag.style.display = 'flex';
    }
  };

  // Ensure local media is ready; if not, initialize and add tracks
  if (!localStream) {
    const stream = await initLocalMedia({ isUserAction: true });
    if (stream && peerConnection && currentPartnerId === partnerId) {
      stream.getTracks().forEach((track) => {
        try {
          peerConnection.addTrack(track, stream);
        } catch (_) {}
      });
    }
  }

  isPeerReady = true;

  // Process any buffered incoming signals that arrived during initialization
  while (signalQueue.length > 0) {
    const queued = signalQueue.shift();
    if (queued.from === currentPartnerId) {
      await handleIncomingSignal(queued.from, queued.signal);
    }
  }

  // If initiator, generate SDP offer now that peer is fully ready
  if (isInitiator && currentPartnerId === partnerId) {
    try {
      isMakingOffer = true;
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
    } finally {
      isMakingOffer = false;
    }
  }
}

function cleanupPeerConnection() {
  clearDisconnectTimer();
  currentPartnerId = null;
  isPeerReady = false;
  pendingCandidates = [];
  signalQueue = [];

  if (remoteCamOff) {
    remoteCamOff.style.display = 'none';
  }

  if (quickReactions) {
    quickReactions.style.display = 'none';
  }

  if (unmuteSoundBtn) {
    unmuteSoundBtn.style.display = 'none';
  }

  if (partnerTag) {
    partnerTag.style.display = 'none';
  }

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.onconnectionstatechange = null;
    try {
      peerConnection.close();
    } catch (_) {}
    peerConnection = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach((t) => {
      try { t.stop(); } catch (_) {}
    });
    remoteStream = null;
  }

  if (remoteVideo) {
    remoteVideo.pause();
    remoteVideo.srcObject = null;
  }

  if (remoteAudio) {
    remoteAudio.pause();
    remoteAudio.srcObject = null;
  }
}

// Button Listeners
startBtn.addEventListener('click', () => {
  startFindingPartner(false);
});

nextBtn.addEventListener('click', () => {
  if (nextCooldownSeconds > 0) return;
  startFindingPartner(true);
});

socket.on('partnerMediaState', ({ videoEnabled, audioEnabled }) => {
  if (remoteCamOff) {
    remoteCamOff.style.display = videoEnabled ? 'none' : 'flex';
  }
});

// Mic & Cam Toggle Controls (Clean SVG toggling via .off class)
micBtn.addEventListener('click', async () => {
  if (!localStream) {
    await initLocalMedia({ isUserAction: true });
    return;
  }
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  micBtn.classList.toggle('off', !micEnabled);
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

// Keyboard Shortcuts (Space: Start, Esc: Next, M: Mute Mic, V: Toggle Cam)
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (permissionModal && permissionModal.style.display === 'flex') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (startBtn && !startBtn.disabled) {
      startFindingPartner(false);
    }
  } else if (e.code === 'Escape') {
    e.preventDefault();
    if (nextBtn && !nextBtn.disabled && nextCooldownSeconds <= 0) {
      startFindingPartner(true);
    }
  } else if (e.key === 'm' || e.key === 'M') {
    if (micBtn) micBtn.click();
  } else if (e.key === 'v' || e.key === 'V') {
    if (camBtn) camBtn.click();
  }
});

