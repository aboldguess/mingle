/**
 * mingle_client.js
 * Mini README:
 * - Purpose: client-side logic for the Mingle prototype. Handles local avatar
 *   movement, webcam streaming, and position synchronisation with the server.
 * - Structure:
 *   1. Socket and DOM initialisation
 *   2. Debug logging helpers
 *   3. UI controls for spectating and camera viewpoints
 *   4. Custom WASD movement handler and real-time status
 *   5. Webcam capture and playback
 *   6. Periodic server synchronisation
 *   7. Remote avatar tracking
 */

// Establish socket connection to the server and cache DOM references.
const socket = io();
const avatar = document.getElementById('avatar');
const avatarBack = document.getElementById('avatarBack');
const player = document.getElementById('player');
const playerCamera = document.getElementById('playerCamera');
const spectateCam = document.getElementById('spectateCam');
const spectateIndicator = document.getElementById('spectateIndicator');
const spectateToggle = document.getElementById('spectateToggle');
const statusEl = document.getElementById('status');
const viewpointRadios = document.querySelectorAll('input[name="viewpoint"]');
// Track which camera supplies the viewer's perspective.
let activeCamera = playerCamera;

// Assign a unique colour to the player for the avatar's back and camera indicator.
const playerColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
avatarBack.setAttribute('color', playerColor);
spectateIndicator.setAttribute('color', playerColor);

// Store yaw and pitch derived from pointer movement for consistent avatar rotation.
let yaw = 0;
let pitch = 0;
const MOUSE_SENSITIVITY = 0.002;

// Ensure spectator camera never responds to built-in WASD controls.
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
// stuck loading screens. Also set up pointer lock handling for mouse look.
sceneEl.addEventListener('loaded', () => {
  debugLog('A-Frame scene loaded');
  if (sceneEl.canvas) {
    sceneEl.canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== sceneEl.canvas) {
        sceneEl.canvas.requestPointerLock();
      }
    });
  }
});

document.addEventListener('pointerlockchange', () => {
  debugLog('Pointer lock', document.pointerLockElement ? 'enabled' : 'disabled');
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === sceneEl.canvas) {
    yaw -= e.movementX * MOUSE_SENSITIVITY;
    pitch -= e.movementY * MOUSE_SENSITIVITY;
    const maxPitch = Math.PI / 2;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
  }
});

// Debug: log connection status
socket.on('connect', () => debugLog('Connected to server', socket.id));

// ---------------------------------------------------------------------------
// UI controls for spectating and camera viewpoints
// ---------------------------------------------------------------------------
const VIEWPOINTS = {
  highCorner: {
    position: { x: 10, y: 10, z: 10 },
    rotation: { x: -35, y: -45, z: 0 }
  },
  groundCorner: {
    position: { x: 10, y: 1.6, z: 10 },
    rotation: { x: 0, y: -45, z: 0 }
  },
  top: {
    position: { x: 0, y: 20, z: 0 },
    rotation: { x: -90, y: 0, z: 0 }
  }
};
let currentView = 'highCorner';
let spectating = false;

function applyViewpoint() {
  const vp = VIEWPOINTS[currentView];
  spectateCam.setAttribute('position', vp.position);
  spectateCam.setAttribute('rotation', vp.rotation);
  spectateIndicator.setAttribute('position', vp.position);
}

function setSpectateMode(enabled) {
  spectating = enabled;
  if (spectating) {
    playerCamera.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('camera', 'active', true);
    spectateCam.setAttribute('visible', true);
    activeCamera = spectateCam;
    avatar.setAttribute('visible', true); // show local avatar while spectating
    spectateIndicator.setAttribute('visible', true);
    applyViewpoint();
    debugLog('Spectate mode enabled');
  } else {
    // Return control to the first-person camera.
    spectateCam.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('visible', false);
    spectateIndicator.setAttribute('visible', false);
    playerCamera.setAttribute('camera', 'active', true);
    activeCamera = playerCamera;
    avatar.setAttribute('visible', false); // hide avatar for first-person view
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
// is calculated relative to the avatar's yaw so that controls behave the same
// whether in first-person or spectate mode.
const MOVE_SPEED = 2; // metres per second
let lastMove = performance.now();
function movementLoop(time) {
  const dt = (time - lastMove) / 1000;
  lastMove = time;

  // Apply accumulated mouse movement to avatar and first-person camera.
  avatar.object3D.rotation.set(pitch, yaw, 0);
  playerCamera.object3D.rotation.set(pitch, yaw, 0);

  const dir = new THREE.Vector3();
  if (keys.w) dir.z -= 1;
  if (keys.s) dir.z += 1;
  if (keys.a) dir.x -= 1;
  if (keys.d) dir.x += 1;

  if (dir.lengthSq() > 0) {
    dir.normalize();
    // Apply the avatar's yaw so movement is relative to the view
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

// Send current position and viewing direction to the server so that remote
// avatars align with the local player's orientation.
setInterval(() => {
  const position = player.getAttribute('position');
  const rotation = {
    x: THREE.MathUtils.radToDeg(pitch),
    y: THREE.MathUtils.radToDeg(yaw),
    z: 0
  };
  socket.emit('position', { position, rotation });
}, 100);

// Track remote avatars
const remotes = {};
socket.on('position', data => {
  let box = remotes[data.id];
  if (!box) {
    box = document.createElement('a-box');
    box.setAttribute('color', '#' + Math.floor(Math.random() * 16777215).toString(16));
    box.setAttribute('width', 1);
    box.setAttribute('height', 1);
    box.setAttribute('depth', 0.1);
    document.querySelector('a-scene').appendChild(box);
    remotes[data.id] = box;
  }
  box.setAttribute('position', data.position);
  box.setAttribute('rotation', data.rotation);
});

socket.on('disconnectClient', id => {
  const box = remotes[id];
  if (box) {
    box.parentNode.removeChild(box);
    delete remotes[id];
  }
});
