/**
 * mingle_client.js
 * Mini README:
 * - Purpose: client-side logic for the Mingle prototype. Handles local avatar
 *   movement, webcam streaming, and position synchronisation with the server.
 *   Default body and TV models are loaded from the server's world configuration
 *   and asset manifest. If none are configured, the client falls back to
 *   `default-body.glb` / `default-tv.glb` or simple box primitives. A plane
 *   representing the webcam feed is positioned relative to the TV using
 *   offsets from the world configuration.
 * - Structure:
 *   1. Socket and DOM initialisation (unique player colour, random spawn,
 *      HTTPS warning)
 *   2. Debug logging helpers
 *   3. Instructions overlay toggle
 *   4. Spectating and fixed camera viewpoint logic (keyboard-driven)
 *   5. Custom WASD movement handler and real-time status including participant
 *      count
 *   6. Webcam and microphone capture and playback
 *   7. WebRTC audio/video sharing between participants
 *   8. Periodic server synchronisation
 *   9. Remote avatar and spectate marker tracking
 *  10. GLB avatar models with webcam texture applied to the TV screen
*/

// Establish socket connection to the server and cache DOM references.
const socket = io();
const avatar = document.getElementById('avatar');
const avatarBody = document.getElementById('avatarBody');
const avatarTV = document.getElementById('avatarTV');
const avatarWebcam = document.getElementById('avatarWebcam');
const player = document.getElementById('player');
const playerCamera = document.getElementById('playerCamera');
// Expose the primary camera globally so auxiliary modules (e.g. mobile
// controls) can adjust its orientation directly when needed.
window.playerCamera = playerCamera;
const spectateCam = document.getElementById('spectateCam');
const spectateMarker = document.getElementById('spectateMarker');
const spectateToggle = document.getElementById('spectateToggle');
const statusEl = document.getElementById('status');
const viewpointRadios = document.querySelectorAll('input[name="viewpoint"]');
const instructionsEl = document.getElementById('instructions');
const instructionsToggle = document.getElementById('instructionsToggle');
// Allow the instructions overlay to be minimised and restored.
if (instructionsEl && instructionsToggle) {
  instructionsToggle.addEventListener('click', () => {
    const hidden = instructionsEl.style.display === 'none';
    instructionsEl.style.display = hidden ? 'block' : 'none';
    instructionsToggle.textContent = hidden ? '\u2212' : '+'; // minus/plus symbol
    instructionsToggle.setAttribute('aria-label', hidden ? 'Hide instructions' : 'Show instructions');
    debugLog(`Instructions ${hidden ? 'shown' : 'hidden'}`);
  });
} else {
  debugError('Instructions toggle elements missing');
}
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
    const previewEl = document.getElementById('selfPreviewVideo');

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      debugLog(`Microphone capture started: ${audioTracks[0].label || 'unknown'} track`);
    } else {
      debugError('No audio tracks found in local stream');
    }

    // Attach the stream to the asset video element and on-screen preview.
    videoEl.muted = true; // ensure autoplay works without user interaction
    videoEl.srcObject = stream;
    if (previewEl) {
      previewEl.muted = true;
      previewEl.srcObject = stream;
      previewEl.play().catch(err => debugError('Preview playback failed', err));
    } else {
      debugError('Self-preview video element missing');
    }
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

// Video texture mapping occurs once default assets resolve later in
// `initDefaultAssets`.

// Randomise the starting location slightly so newcomers do not overlap. The
// player entity is rooted at ground level so `y` remains 0 to keep feet on the
// floor.
const startPos = { x: Math.random() * 4 - 2, y: 0, z: Math.random() * 4 - 2 };
player.setAttribute('position', startPos);

// Warn the user if the page is not served over HTTPS which prevents webcam and
// device sensor access on most browsers when using a LAN address.
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
  document.getElementById('instructions').innerHTML +=
    '<p><strong>HTTPS required:</strong> Access this site over HTTPS to enable the webcam, VR mode and device sensors.</p>';
  debugLog('Insecure context detected; camera and sensors disabled until HTTPS is used.');
}

// Enumerate available viewing modes.
const MODE_FPV = 'FPV';
const MODE_SPECTATOR = 'Spectator';
const MODE_LAKITU = 'Lakitu';
let currentMode = null; // populated once the initial mode is set

// Assign a unique colour to this player used for the spectate marker. This
// colour is shared with other clients via socket updates.
const playerColor = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
spectateMarker.setAttribute('color', playerColor);

// Ensure spectator camera never responds to built-in WASD controls and pause its
// look-controls so mouse movement never rotates it.
spectateCam.setAttribute('wasd-controls', 'enabled', false);
const sceneEl = document.querySelector('a-scene');
const assetsEl = sceneEl.querySelector('a-assets');

// Details of the default body and TV models loaded from the server. These
// determine the avatar appearance for local and remote participants.
let defaultBodyEntry = null;
let defaultTVEntry = null;
// Size of the fallback black cube used for the TV head. The webcam feed plane
// matches this size so it perfectly covers the front face.
const FALLBACK_TV_SIZE = 0.5;
const WEB_CAM_EPSILON = 0.001; // slight offset so the plane renders on the surface
// Stored offset for positioning the TV relative to the body and webcam relative to the TV.
let tvOffset = { x: 0, y: 1.6, z: 0 };
let webcamOffset = {
  x: 0,
  y: 0,
  // Negative z places the webcam feed on the front face rather than behind the cube.
  z: -(FALLBACK_TV_SIZE / 2 + WEB_CAM_EPSILON),
  scale: FALLBACK_TV_SIZE,
};

/**
 * Fetch world configuration and asset manifest to determine which body and TV
 * models to use. Falls back to static default files or simple primitives when
 * none are configured. Applies saved scale and TV offset so avatars start with
 * consistent placement.
 */
async function initDefaultAssets() {
  try {
    const [manifestRes, configRes] = await Promise.all([
      fetch('/api/assets'),
      fetch('/world-config'),
    ]);
    const manifest = await manifestRes.json();
    const config = await configRes.json();
    if (config.tvPosition) {
      tvOffset = config.tvPosition;
    }
    if (config.webcamOffset) {
      webcamOffset = config.webcamOffset;
    }
    if (config.defaultBodyId) {
      defaultBodyEntry = manifest.bodies.find(b => b.id === config.defaultBodyId) || null;
    }
    if (config.defaultTvId) {
      defaultTVEntry = manifest.tvs.find(t => t.id === config.defaultTvId) || null;
    }
  } catch (err) {
    debugError('Failed to fetch asset manifest or world config', err);
  }

  // Load body model or fall back to a primitive
  if (defaultBodyEntry) {
    const bodyItem = document.createElement('a-asset-item');
    bodyItem.id = 'default-body';
    bodyItem.src = `/assets/${defaultBodyEntry.filename}`;
    assetsEl.appendChild(bodyItem);
    avatarBody.setAttribute('gltf-model', '#default-body');
    avatarBody.setAttribute('scale', `${defaultBodyEntry.scale} ${defaultBodyEntry.scale} ${defaultBodyEntry.scale}`);
  } else {
    try {
      const res = await fetch('/assets/default-body.glb', { method: 'HEAD' });
      if (res.ok) {
        defaultBodyEntry = { id: 'default-body', filename: 'default-body.glb', scale: 1 };
        const bodyItem = document.createElement('a-asset-item');
        bodyItem.id = 'default-body';
        bodyItem.src = '/assets/default-body.glb';
        assetsEl.appendChild(bodyItem);
        avatarBody.setAttribute('gltf-model', '#default-body');
      } else {
        avatarBody.setAttribute('geometry', 'primitive: box; height: 1.6; width: 0.5; depth: 0.3');
        avatarBody.setAttribute('material', 'color: #AAAAAA');
      }
    } catch {
      avatarBody.setAttribute('geometry', 'primitive: box; height: 1.6; width: 0.5; depth: 0.3');
      avatarBody.setAttribute('material', 'color: #AAAAAA');
    }
  }

  // Load TV model or fall back to a primitive
  const videoEl = document.getElementById('localVideo');
  avatarTV.setAttribute('position', `${tvOffset.x} ${tvOffset.y} ${tvOffset.z}`);
  if (defaultTVEntry) {
    const tvItem = document.createElement('a-asset-item');
    tvItem.id = 'default-tv';
    tvItem.src = `/assets/${defaultTVEntry.filename}`;
    assetsEl.appendChild(tvItem);
    avatarTV.setAttribute('gltf-model', '#default-tv');
    avatarTV.setAttribute('scale', `${defaultTVEntry.scale} ${defaultTVEntry.scale} ${defaultTVEntry.scale}`);
  } else {
    try {
      const res = await fetch('/assets/default-tv.glb', { method: 'HEAD' });
      if (res.ok) {
        defaultTVEntry = { id: 'default-tv', filename: 'default-tv.glb', scale: 1 };
        const tvItem = document.createElement('a-asset-item');
        tvItem.id = 'default-tv';
        tvItem.src = '/assets/default-tv.glb';
        assetsEl.appendChild(tvItem);
        avatarTV.setAttribute('gltf-model', '#default-tv');
      } else {
        avatarTV.setAttribute('geometry', `primitive: box; height: ${FALLBACK_TV_SIZE}; width: ${FALLBACK_TV_SIZE}; depth: ${FALLBACK_TV_SIZE}`);
        avatarTV.setAttribute('material', 'color: #222222');
      }
    } catch {
      avatarTV.setAttribute('geometry', `primitive: box; height: ${FALLBACK_TV_SIZE}; width: ${FALLBACK_TV_SIZE}; depth: ${FALLBACK_TV_SIZE}`);
      avatarTV.setAttribute('material', 'color: #222222');
    }
  }
  if (avatarWebcam) {
    avatarWebcam.setAttribute('material', `shader: flat; src: #localVideo`);
    avatarWebcam.setAttribute('position', `${webcamOffset.x} ${webcamOffset.y} ${webcamOffset.z}`);
    avatarWebcam.setAttribute('width', webcamOffset.scale);
    avatarWebcam.setAttribute('height', webcamOffset.scale);
  }
}

initDefaultAssets();

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

// Apply a VideoTexture to the `screen` mesh of the provided model. Falls back
// to the model root if a dedicated mesh is not found. Optional `screen` UV
// coordinates allow cropping to a subregion of the texture.
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

// When the admin updates default avatars or placement, reload to apply changes.
socket.on('updateAvatars', () => {
  location.reload();
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
  if (spectateToggle) {
    spectateToggle.checked = spectating;
  }
  updateStatus();
}

// Configure the scene based on the requested viewing mode.
function selectMode(mode) {
  currentMode = mode === 'fpv' ? MODE_FPV : mode === 'spectator' ? MODE_SPECTATOR : MODE_LAKITU;
  debugLog('Mode selected', currentMode);

  // Reset player and camera positions to the centre of the world for a fresh start.
  player.setAttribute('position', { x: 0, y: 0, z: 0 });
  playerCamera.setAttribute('position', { x: 0, y: 1.6, z: 0 });

  if (currentMode === MODE_SPECTATOR) {
    setSpectateMode(true);
    spectateCam.setAttribute('position', VIEWPOINTS.high.position);
  } else if (currentMode === MODE_LAKITU) {
    setSpectateMode(false);
    avatar.setAttribute('visible', true);
    playerCamera.setAttribute('position', { x: 0, y: 1.6, z: 3 });
    // Point the camera at the avatar to start.
    playerCamera.object3D.lookAt(player.object3D.position);
  } else {
    setSpectateMode(false);
  }
  updateStatus();
}

function updateStatus() {
  if (!statusEl) {
    return;
  }
  if (!currentMode) {
    statusEl.textContent = `Mode: (initialising) | Users: ${connectedClients}`;
    return;
  }
  const pos = activeCamera.object3D.position;
  statusEl.textContent = `Mode: ${currentMode} | Camera: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)} | Users: ${connectedClients}`;
}

if (spectateToggle) {
  spectateToggle.addEventListener('change', () => {
    if (currentMode === MODE_LAKITU) {
      spectateToggle.checked = false; // spectating disabled in Lakitu mode
      return;
    }
    setSpectateMode(spectateToggle.checked);
    currentMode = spectating ? MODE_SPECTATOR : MODE_FPV;
    updateStatus();
  });
}
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

// Start directly in first-person mode.
selectMode('fpv');

// ---------------------------------------------------------------------------
// Custom movement handling
// ---------------------------------------------------------------------------
// Track the state of movement keys so that we can drive the player entity
// manually. This avoids relying on A-Frame's wasd-controls which depend on the
// currently active camera and caused erratic movement when spectating.
const keys = { w: false, a: false, s: false, d: false };
// Publish key state globally so other scripts (e.g. touch joystick handlers)
// can mirror WASD input for mobile users.
window.keys = keys;
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

    // Defensive: wait for mode initialisation before processing movement.
    if (!currentMode) {
      requestAnimationFrame(movementLoop);
      return;
    }

  // Mirror the camera's yaw on the avatar so the body rotates with left/right
  // look movement. Tilt the TV separately using the camera pitch so the body
  // stays upright when looking up or down. In Lakitu mode the avatar remains
  // fixed and unrotated.
  if (currentMode !== MODE_LAKITU) {
    const camRot = playerCamera.object3D.rotation;
    // Apply only yaw to the avatar body.
    avatar.object3D.rotation.set(0, camRot.y, 0);
    // Apply pitch to the TV so it nods independently of the body.
    avatarTV.object3D.rotation.set(camRot.x, 0, 0);
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
  // Extract rotation in degrees and separate TV tilt so only yaw is applied to the body.
  const camRot = playerCamera.getAttribute('rotation');
  const rotation = { x: 0, y: camRot.y, z: 0 };
  const tvTilt = camRot.x;
  const spectatePos = currentMode === MODE_SPECTATOR ? spectateCam.getAttribute('position') : null;
  socket.emit('position', { position, rotation, tvTilt, color: playerColor, spectatePos });
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
    // Remote avatar mirrors local structure: body model plus TV head with webcam feed.
    const avatarEntity = document.createElement('a-entity');
    avatarEntity.id = `avatar-${data.id}`; // allow audio entities to attach for spatial sound

    const body = document.createElement('a-entity');
    if (defaultBodyEntry) {
      body.setAttribute('gltf-model', '#default-body');
      body.setAttribute('scale', `${defaultBodyEntry.scale} ${defaultBodyEntry.scale} ${defaultBodyEntry.scale}`);
    } else {
      body.setAttribute('geometry', 'primitive: box; height: 1.6; width: 0.5; depth: 0.3');
      body.setAttribute('material', 'color: #AAAAAA');
    }
    // Offset the body so its feet touch the ground when the avatar root is at y=0.
    body.setAttribute('position', '0 0.8 0');

    const videoEl = document.createElement('video');
    videoEl.id = `video-${data.id}`;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true; // audio handled separately
    assetsEl.appendChild(videoEl);

    const tv = document.createElement('a-entity');
    if (defaultTVEntry) {
      tv.setAttribute('gltf-model', '#default-tv');
      tv.setAttribute('scale', `${defaultTVEntry.scale} ${defaultTVEntry.scale} ${defaultTVEntry.scale}`);
    } else {
      tv.setAttribute('geometry', `primitive: box; height: ${FALLBACK_TV_SIZE}; width: ${FALLBACK_TV_SIZE}; depth: ${FALLBACK_TV_SIZE}`);
      tv.setAttribute('material', 'color: #222222');
    }
    // Position the TV head so the screen (and FPV camera) sit at eye level or saved offset.
    tv.setAttribute('position', `${tvOffset.x} ${tvOffset.y} ${tvOffset.z}`);

    const camPlane = document.createElement('a-plane');
    camPlane.setAttribute('position', `${webcamOffset.x} ${webcamOffset.y} ${webcamOffset.z}`);
    camPlane.setAttribute('width', webcamOffset.scale);
    camPlane.setAttribute('height', webcamOffset.scale);
    camPlane.setAttribute('material', `shader: flat; src: #video-${data.id}`);
    tv.appendChild(camPlane);

    avatarEntity.appendChild(body);
    avatarEntity.appendChild(tv);

    const camBox = document.createElement('a-box');
    camBox.setAttribute('color', data.color || '#888888');
    camBox.setAttribute('width', 0.5);
    camBox.setAttribute('height', 0.5);
    camBox.setAttribute('depth', 0.5);
    camBox.setAttribute('visible', false);

    sceneEl.appendChild(avatarEntity);
    sceneEl.appendChild(camBox);
    remotes[data.id] = { avatar: avatarEntity, cam: camBox, tv };
    remote = remotes[data.id];
    debugLog('Remote avatar created for', data.id);
  }

  remote.avatar.setAttribute('position', data.position);
  if (data.rotation) {
    // Only apply yaw so the remote body stays upright.
    remote.avatar.setAttribute('rotation', { x: 0, y: data.rotation.y, z: 0 });
  }
  if (remote.tv) {
    // Tilt the remote TV using the transmitted pitch value.
    const tilt = data.tvTilt || 0;
    remote.tv.setAttribute('rotation', { x: tilt, y: 0, z: 0 });
  }
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
