/**
 * mingle_client.js
 * Mini README:
 * - Purpose: client-side logic for the Mingle prototype. Handles local avatar
 *   movement, webcam streaming, and position synchronisation with the server.
 * - Structure:
 *   1. Socket and DOM initialisation (unique player colour, random spawn,
 *      HTTPS warning)
 *   2. Debug logging helpers
 *   3. Start menu and UI controls for spectating and fixed camera viewpoints
 *   4. Custom WASD movement handler and real-time status including participant
 *      count
 *   5. Webcam and microphone capture and playback
 *   6. WebRTC audio/video sharing between participants
 *   7. Periodic server synchronisation
 *   8. Remote avatar and spectate marker tracking
 */

// Establish socket connection to the server and cache DOM references.
const socket = io();
const avatar = document.getElementById('avatar');
const avatarBack = document.getElementById('avatarBack');
const player = document.getElementById('player');
const playerCamera = document.getElementById('playerCamera');
const spectateCam = document.getElementById('spectateCam');
const spectateMarker = document.getElementById('spectateMarker');
const spectateToggle = document.getElementById('spectateToggle');
const statusEl = document.getElementById('status');
const viewpointRadios = document.querySelectorAll('input[name="viewpoint"]');
const modeMenu = document.getElementById('modeMenu');
const modeButtons = modeMenu ? modeMenu.querySelectorAll('button') : [];
// Track which camera is currently rendering the view for status display.
let activeCamera = playerCamera;
// Track participant count for on-screen diagnostics.
let connectedClients = 1;
// Map of peer connections keyed by socket ID for WebRTC video streams.
const peerConnections = {};
// Local webcam stream so it can be shared with remote peers. A promise is used
// so that WebRTC setup can await camera availability, ensuring late joiners
// still transmit video once their stream initialises.
let localStream = null;
// Request both video and audio so microphone capture is available for voice chat.
const localStreamPromise = navigator.mediaDevices
  .getUserMedia({ video: true, audio: true })
  .then(stream => {
    localStream = stream;
    const videoEl = document.getElementById('localVideo');

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      debugLog(`Microphone capture started: ${audioTracks[0].label || 'unknown'} track`);
    } else {
      debugError('No audio tracks found in local stream');
    }

    // Attach the stream to the video element. Muting allows autoplay which
    // prevents the A-Frame loader from stalling waiting for the video.
    videoEl.muted = true;
    videoEl.srcObject = stream;
    videoEl.onloadeddata = () => {
      debugLog('Webcam video element loaded');
      // The scene is already visible because the default loading screen is
      // disabled, so we avoid manually firing the 'loaded' event which could
      // trigger A-Frame initialisation before its renderer is ready.
    };

    // Some browsers require an explicit play() call. Log success/failure for
    // easier debugging.
    return videoEl.play()
      .then(() => {
        debugLog('Webcam stream started');
        return stream;
      })
      .catch(err => {
        debugError('Webcam playback failed', err);
        return stream; // still resolve so connections proceed without video
      });
  })
  .catch(err => {
    // If the webcam or microphone cannot start, log the error (in debug mode)
    // and inform the user on-screen. The scene still renders thanks to the
    // disabled loading screen.
    debugError('Could not start webcam or microphone', err);
    document.getElementById('instructions').innerHTML +=
      '<p>Webcam or microphone unavailable. Check media permissions.</p>';
    throw err; // propagate failure so peer connections know no stream exists
  });

// Randomise the starting location slightly so newcomers do not overlap and
// immediately appear to others in the shared world.
const startPos = { x: Math.random() * 4 - 2, y: 1.6, z: Math.random() * 4 - 2 };
player.setAttribute('position', startPos);

// Warn the user if the page is not served over HTTPS which prevents webcam and
// device sensor access on most browsers when using a LAN address.
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
  document.getElementById('instructions').innerHTML +=
    '<p><strong>HTTPS required:</strong> Access this site over HTTPS to enable the webcam, VR mode and device sensors.</p>';
  debugLog('Insecure context detected; camera and sensors disabled until HTTPS is used.');
}

// Enumerate the entry modes selectable via the start menu.
const MODE_FPV = 'FPV';
const MODE_SPECTATOR = 'Spectator';
const MODE_LAKITU = 'Lakitu';
let currentMode = null; // populated once the user chooses how to enter

// Assign a unique colour to this player used for the avatar's back and the
// spectate marker. This colour is shared with other clients via socket updates.
const playerColor = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
avatarBack.setAttribute('color', playerColor);
spectateMarker.setAttribute('color', playerColor);

// When the user picks a mode from the start menu, configure the scene.
modeButtons.forEach(btn => btn.addEventListener('click', () => selectMode(btn.dataset.mode)));

// Ensure spectator camera never responds to built-in WASD controls and pause its
// look-controls so mouse movement never rotates it.
spectateCam.setAttribute('wasd-controls', 'enabled', false);
const sceneEl = document.querySelector('a-scene');
const assetsEl = sceneEl.querySelector('a-assets');

// Simple helpers that only log when debug mode is enabled. The flag is
// injected by the server via /config.js.
function debugLog(...args) {
  if (window.MINGLE_DEBUG) {
    console.log(...args);
  }
}
function debugError(...args) {
  if (window.MINGLE_DEBUG) {
    console.error(...args);
  }
}

// Log when the A-Frame scene has finished initialising which helps debug
// stuck loading screens.
sceneEl.addEventListener('loaded', () => {
  debugLog('A-Frame scene loaded');
  // Only the first-person camera should process mouse movement. The spectator
  // camera's look-controls stay paused permanently so it never rotates. The
  // first-person camera explicitly plays its look-controls so mouse movement
  // continues to drive avatar orientation even when not the active view.
  if (spectateCam.components['look-controls']) {
    spectateCam.components['look-controls'].pause();
  }
  if (playerCamera.components['look-controls']) {
    playerCamera.components['look-controls'].play();
  }
});

// Debug: log connection status
socket.on('connect', () => {
  debugLog('Connected to server', socket.id);
  document.getElementById('instructions').innerHTML += '<p>Connected to server.</p>';
});
socket.on('connect_error', (err) => {
  document.getElementById('instructions').innerHTML += '<p>Cannot reach server.</p>';
  debugError('Socket connection error', err);
});

// Receive participant count updates from the server so users know if others are
// present in the shared world.
socket.on('clientCount', (count) => {
  connectedClients = count;
  updateStatus();
});

// ---------------------------------------------------------------------------
// WebRTC signalling for webcam sharing
// ---------------------------------------------------------------------------
socket.on('rtc-offer', async ({ from, offer }) => {
  debugLog('Received RTC offer from', from);
  const pc = peerConnections[from] || await createPeerConnection(from);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('rtc-answer', { to: from, answer });
});

socket.on('rtc-answer', async ({ from, answer }) => {
  debugLog('Received RTC answer from', from);
  const pc = peerConnections[from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on('ice-candidate', ({ from, candidate }) => {
  const pc = peerConnections[from];
  if (pc && candidate) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => debugError('ICE add error', err));
  }
});

async function createPeerConnection(id) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections[id] = pc;

  try {
    const stream = await localStreamPromise;
    // Share both video and audio tracks so peers receive full AV streams.
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    debugLog('Added local tracks to peer connection',
      stream.getTracks().map(t => t.kind));
  } catch (err) {
    debugError('Local stream unavailable for peer connection', err);
  }

  pc.ontrack = (event) => {
    const videoEl = document.getElementById(`video-${id}`);
    if (videoEl) {
      videoEl.srcObject = event.streams[0];
      videoEl.play().catch(err => debugError('Remote video playback failed', err));
    }
    // Route accompanying audio through positional sound helpers.
    if (typeof attachRemoteAudio === 'function') {
      attachRemoteAudio(event.streams[0], id);
    } else {
      debugError('attachRemoteAudio not available for remote stream', id);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: id, candidate: event.candidate });
    }
  };

  return pc;
}

// ---------------------------------------------------------------------------
// UI controls for spectating and camera viewpoints
// ---------------------------------------------------------------------------
const VIEWPOINTS = {
  high: {
    position: { x: 10, y: 10, z: 10 },
    rotation: { x: -35, y: -45, z: 0 }
  },
  ground: {
    position: { x: 10, y: 1.6, z: 10 },
    rotation: { x: 0, y: -45, z: 0 }
  },
  top: {
    position: { x: 0, y: 20, z: 0 },
    rotation: { x: -90, y: 0, z: 0 }
  }
};
let currentView = 'high';
let spectating = false;

function applyViewpoint() {
  const vp = VIEWPOINTS[currentView];
  spectateCam.setAttribute('position', vp.position);
  spectateCam.setAttribute('rotation', vp.rotation);
  spectateMarker.setAttribute('position', vp.position);
}

function setSpectateMode(enabled) {
  spectating = enabled;
  if (spectating) {
    // Switch rendering to the spectator camera. Mouse movement continues to
    // control the player camera which in turn drives avatar orientation.
    playerCamera.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('camera', 'active', true);
    spectateCam.setAttribute('visible', true);
    spectateMarker.setAttribute('visible', true);
    activeCamera = spectateCam;
    avatar.setAttribute('visible', true); // show local avatar while spectating
    applyViewpoint();
    // Ensure the spectator camera never reacts to mouse movement and keep the
    // player camera responsive so the avatar can still rotate/tilt.
    if (spectateCam.components['look-controls']) {
      spectateCam.components['look-controls'].pause();
    }
    if (playerCamera.components['look-controls']) {
      playerCamera.components['look-controls'].play();
    }
    debugLog('Spectate mode enabled');
  } else {
    // Return control to the first-person camera.
    spectateCam.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('visible', false);
    spectateMarker.setAttribute('visible', false);
    playerCamera.setAttribute('camera', 'active', true);
    activeCamera = playerCamera;
    avatar.setAttribute('visible', false); // hide avatar for first-person view
    // Defensive: keep spectator camera frozen if toggled again.
    if (spectateCam.components['look-controls']) {
      spectateCam.components['look-controls'].pause();
    }
    debugLog('Spectate mode disabled');
  }
  spectateToggle.checked = spectating;
  updateStatus();
}

// Entry point after the user selects how they wish to view the world.
function selectMode(mode) {
  currentMode = mode === 'fpv' ? MODE_FPV : mode === 'spectator' ? MODE_SPECTATOR : MODE_LAKITU;
  modeMenu.classList.add('hidden');
  debugLog('Mode selected', currentMode);

  // Reset player and camera positions to the centre of the world for a fresh start.
  player.setAttribute('position', { x: 0, y: 1.6, z: 0 });
  playerCamera.setAttribute('position', { x: 0, y: 0, z: 0 });

  if (currentMode === MODE_SPECTATOR) {
    setSpectateMode(true);
    spectateCam.setAttribute('position', VIEWPOINTS.high.position);
  } else if (currentMode === MODE_LAKITU) {
    setSpectateMode(false);
    avatar.setAttribute('visible', true);
    playerCamera.setAttribute('position', { x: 0, y: 0, z: 3 });
    // Point the camera at the avatar to start.
    playerCamera.object3D.lookAt(player.object3D.position);
  } else {
    setSpectateMode(false);
  }
  updateStatus();
}

function updateStatus() {
  if (!currentMode) {
    statusEl.textContent = `Mode: (select) | Users: ${connectedClients}`;
    return;
  }
  const pos = activeCamera.object3D.position;
  statusEl.textContent = `Mode: ${currentMode} | Camera: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)} | Users: ${connectedClients}`;
}

spectateToggle.addEventListener('change', () => {
  if (currentMode === MODE_LAKITU) {
    spectateToggle.checked = false; // spectating disabled in Lakitu mode
    return;
  }
  setSpectateMode(spectateToggle.checked);
  currentMode = spectating ? MODE_SPECTATOR : MODE_FPV;
  updateStatus();
});
viewpointRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      currentView = radio.value;
      applyViewpoint();
      updateStatus();
      debugLog('Viewpoint changed to', currentView);
    }
  });
});

// Keyboard shortcut mirrors the checkbox for convenience
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'p' && currentMode !== MODE_LAKITU) {
    setSpectateMode(!spectating);
    currentMode = spectating ? MODE_SPECTATOR : MODE_FPV;
    updateStatus();
  }
});
updateStatus();

// ---------------------------------------------------------------------------
// Custom movement handling
// ---------------------------------------------------------------------------
// Track the state of movement keys so that we can drive the player entity
// manually. This avoids relying on A-Frame's wasd-controls which depend on the
// currently active camera and caused erratic movement when spectating.
const keys = { w: false, a: false, s: false, d: false };
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) {
    // Prevent the browser from processing the key so movement always works.
    e.preventDefault();
    keys[k] = true;
  }
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) {
    e.preventDefault();
    keys[k] = false;
  }
});

// Move the player a tiny amount each frame based on the pressed keys. Movement
// is calculated relative to the player camera's yaw so that controls behave the
// same whether in first-person or spectate mode.
const MOVE_SPEED = 2; // metres per second
let lastMove = performance.now();
function movementLoop(time) {
  const dt = (time - lastMove) / 1000;
  lastMove = time;

  // Do nothing until the user has selected a mode.
  if (!currentMode) {
    requestAnimationFrame(movementLoop);
    return;
  }

  // Mirror the player camera's rotation on the avatar so it visually matches the
  // viewer's perspective. In Lakitu mode the avatar remains fixed and unrotated.
  if (currentMode !== MODE_LAKITU) {
    avatar.object3D.rotation.copy(playerCamera.object3D.rotation);
  }

  const dir = new THREE.Vector3();
  if (keys.w) dir.z -= 1;
  if (keys.s) dir.z += 1;
  if (keys.a) dir.x -= 1;
  if (keys.d) dir.x += 1;

  if (dir.lengthSq() > 0) {
    dir.normalize();
    // Apply the player camera's yaw so movement is relative to the view
    const yaw = playerCamera.object3D.rotation.y;
    dir.applyEuler(new THREE.Euler(0, yaw, 0));
    if (currentMode === MODE_LAKITU) {
      // Lakitu camera orbits independently; move the player camera.
      playerCamera.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
    } else if (currentMode === MODE_SPECTATOR) {
      // In spectator mode move the spectator camera and keep the marker in sync.
      spectateCam.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
      spectateMarker.object3D.position.copy(spectateCam.object3D.position);
      debugLog('Spectator camera moved to', spectateCam.object3D.position);
    } else {
      // Default first-person movement translates the player entity.
      player.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
    }
  }

  if (currentMode === MODE_SPECTATOR) {
    // Keep the spectator camera aimed at the avatar unless extremely close to
    // avoid jitter when both occupy nearly the same space.
    const dist = spectateCam.object3D.position.distanceTo(player.object3D.position);
    if (dist > 0.1) {
      spectateCam.object3D.lookAt(player.object3D.position);
    }
  }

  updateStatus();
  requestAnimationFrame(movementLoop);
}
requestAnimationFrame(movementLoop);

// Send current position, viewing direction and spectate camera location to the
// server. The player camera's rotation represents avatar orientation.
setInterval(() => {
  const position = player.getAttribute('position');
  const rotation = playerCamera.getAttribute('rotation');
  const spectatePos = currentMode === MODE_SPECTATOR ? spectateCam.getAttribute('position') : null;
  socket.emit('position', { position, rotation, color: playerColor, spectatePos });
}, 100);

// Track remote avatars and their spectate camera markers. Each entry mirrors a
// participant in the scene so everyone sees all other users.
const remotes = {};
socket.on('position', async data => {
  // The server echoes position updates to every client, including the sender.
  // Skip our own entry so only other participants generate remote avatars.
  if (data.id === socket.id) { return; }

  // Ensure a WebRTC peer connection exists so we can receive the remote video.
  if (!peerConnections[data.id]) {
    const pc = await createPeerConnection(data.id);
    if (socket.id < data.id) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('rtc-offer', { to: data.id, offer: pc.localDescription });
        debugLog('Sent RTC offer to', data.id);
      } catch (err) {
        debugError('Failed to create offer', err);
      }
    }
  }

  let remote = remotes[data.id];
  if (!remote) {
    // Remote avatars replicate the local #avatar: a forward-facing plane that
    // displays the participant's video stream and a white backing plane so the
    // texture only appears on the front.
    const avatarEntity = document.createElement('a-entity');
    avatarEntity.id = `avatar-${data.id}`; // allow audio entities to attach for spatial sound

    const videoEl = document.createElement('video');
    videoEl.id = `video-${data.id}`;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = false; // allow remote audio playback; may require user gesture
    assetsEl.appendChild(videoEl);

    const front = document.createElement('a-plane');
    front.setAttribute('width', 1);
    front.setAttribute('height', 1);
    front.setAttribute('position', '0 0 -0.05');
    front.setAttribute('rotation', '0 180 0'); // face the same direction as the avatar
    front.setAttribute('material', `src:#${videoEl.id}`);

    const back = document.createElement('a-plane');
    back.setAttribute('width', 1);
    back.setAttribute('height', 1);
    back.setAttribute('position', '0 0 0.05');
    back.setAttribute('color', '#FFFFFF');

    avatarEntity.appendChild(front);
    avatarEntity.appendChild(back);

    const camBox = document.createElement('a-box');
    camBox.setAttribute('color', data.color || '#888888');
    camBox.setAttribute('width', 0.5);
    camBox.setAttribute('height', 0.5);
    camBox.setAttribute('depth', 0.5);
    camBox.setAttribute('visible', false);

    sceneEl.appendChild(avatarEntity);
    sceneEl.appendChild(camBox);
    remotes[data.id] = { avatar: avatarEntity, cam: camBox };
    remote = remotes[data.id];
    debugLog('Remote avatar created for', data.id);
  }

  remote.avatar.setAttribute('position', data.position);
  remote.avatar.setAttribute('rotation', data.rotation);
  if (data.spectatePos) {
    remote.cam.setAttribute('position', data.spectatePos);
    remote.cam.setAttribute('visible', true);
  } else {
    remote.cam.setAttribute('visible', false);
  }
});

socket.on('disconnectClient', id => {
  const remote = remotes[id];
  if (remote) {
    remote.avatar.parentNode.removeChild(remote.avatar);
    remote.cam.parentNode.removeChild(remote.cam);
    delete remotes[id];
  }
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  const vid = document.getElementById(`video-${id}`);
  if (vid && vid.parentNode) {
    vid.parentNode.removeChild(vid);
  }
});
