/**
 * mingle_client.js
 * Mini README:
 * - Purpose: client-side logic for the Mingle prototype. Handles local avatar
 *   movement, webcam streaming, and position synchronisation with the server.
 * - Structure:
 *   1. Socket and DOM initialisation (including unique player colour)
 *   2. Debug logging helpers
 *   3. UI controls for spectating and fixed camera viewpoints
 *   4. Custom WASD movement handler and real-time status
 *   5. Webcam capture and playback
 *   6. Periodic server synchronisation
 *   7. Remote avatar and spectate marker tracking (mirrors local avatar with
 *      placeholder video for other participants)
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
// Track which camera is currently rendering the view for status display.
let activeCamera = playerCamera;

// Assign a unique colour to this player used for the avatar's back and the
// spectate marker. This colour is shared with other clients via socket updates.
const playerColor = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
avatarBack.setAttribute('color', playerColor);
spectateMarker.setAttribute('color', playerColor);

// Ensure spectator camera never responds to built-in WASD controls and pause its
// look-controls so mouse movement never rotates it.
spectateCam.setAttribute('wasd-controls', 'enabled', false);
const sceneEl = document.querySelector('a-scene');

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
socket.on('connect', () => debugLog('Connected to server', socket.id));

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

function updateStatus() {
  const pos = activeCamera.object3D.position;
  statusEl.textContent = `Mode: ${spectating ? 'Spectate' : 'First-person'} | Camera: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
}

spectateToggle.addEventListener('change', () => setSpectateMode(spectateToggle.checked));
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
  if (e.key.toLowerCase() === 'p') {
    setSpectateMode(!spectating);
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

  // Mirror the player camera's rotation on the avatar so it visually matches the
  // viewer's perspective without rotating the parent entity (avoids compounded
  // axes in first-person mode).
  avatar.object3D.rotation.copy(playerCamera.object3D.rotation);

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
    player.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
  }

  updateStatus();
  requestAnimationFrame(movementLoop);
}
requestAnimationFrame(movementLoop);

// Capture webcam
navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then(stream => {
    const videoEl = document.getElementById('localVideo');

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
    videoEl.play()
      .then(() => debugLog('Webcam stream started'))
      .catch(err => debugError('Webcam playback failed', err));
  })
  .catch(err => {
    // If the webcam cannot start, log the error (in debug mode) and inform the
    // user on-screen. The scene still renders thanks to the disabled loading
    // screen.
    debugError('Could not start webcam', err);
    document.getElementById('instructions').innerHTML +=
      '<p>Webcam unavailable. Check camera permissions.</p>';
  });

// Send current position, viewing direction and spectate camera location to the
// server. The player camera's rotation represents avatar orientation.
setInterval(() => {
  const position = player.getAttribute('position');
  const rotation = playerCamera.getAttribute('rotation');
  const spectatePos = spectating ? spectateCam.getAttribute('position') : null;
  socket.emit('position', { position, rotation, color: playerColor, spectatePos });
}, 100);

// Track remote avatars and their spectate camera markers. Each entry mirrors a
// participant in the scene so everyone sees all other users.
const remotes = {};
socket.on('position', data => {
  // The server echoes position updates to every client, including the sender.
  // Skip our own entry so only other participants generate remote avatars.
  if (data.id === socket.id) { return; }

  let remote = remotes[data.id];
  if (!remote) {
    // Remote avatars replicate the local #avatar: a forward-facing plane that
    // would display the participant's video stream and a white backing plane
    // so the texture only appears on the front. Video streaming for remotes is
    // not yet wired up, so we use a grey placeholder colour instead.
    const avatarEntity = document.createElement('a-entity');

    const front = document.createElement('a-plane');
    front.setAttribute('width', 1);
    front.setAttribute('height', 1);
    front.setAttribute('position', '0 0 -0.05');
    front.setAttribute('rotation', '0 180 0'); // face the same direction as the avatar
    front.setAttribute('color', '#888888'); // placeholder until remote video is streamed

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
});
