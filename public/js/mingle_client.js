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
const player = document.getElementById('player');
const playerCamera = document.getElementById('playerCamera');
const spectateCam = document.getElementById('spectateCam');
const spectateToggle = document.getElementById('spectateToggle');
const fixCameraToggle = document.getElementById('fixCameraToggle');
const statusEl = document.getElementById('status');
const viewpointRadios = document.querySelectorAll('input[name="viewpoint"]');
// `controlCamera` always captures mouse rotation to drive the avatar's
// orientation. `viewCamera` is the camera used for rendering (toggled when
// entering/exiting spectate mode).
let controlCamera = playerCamera;
let viewCamera = playerCamera;

// Ensure spectator camera never responds to built-in WASD controls and pause its
// look-controls until explicitly activated to avoid competing with the primary
// camera.
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
  // Only the first-person camera should process mouse movement initially.
  // Pause the spectator camera's look-controls until spectate mode is enabled.
  if (spectateCam.components['look-controls']) {
    spectateCam.components['look-controls'].pause();
  }
});

// Debug: log connection status
socket.on('connect', () => debugLog('Connected to server', socket.id));

// ---------------------------------------------------------------------------
// UI controls for spectating and camera viewpoints
// ---------------------------------------------------------------------------
const VIEWPOINTS = {
  corner: {
    position: { x: 10, y: 10, z: 10 },
    rotation: { x: -35, y: -45, z: 0 },
    offset: new THREE.Vector3(5, 5, 5)
  },
  top: {
    position: { x: 0, y: 20, z: 0 },
    rotation: { x: -90, y: 0, z: 0 },
    offset: new THREE.Vector3(0, 10, 0)
  },
  behind: {
    position: { x: 0, y: 3, z: -10 },
    rotation: { x: 0, y: 0, z: 0 },
    offset: new THREE.Vector3(0, 2, -5)
  }
};
let currentView = 'corner';
let followOffset = VIEWPOINTS[currentView].offset.clone();
let spectating = false;

function applyViewpoint() {
  const vp = VIEWPOINTS[currentView];
  if (fixCameraToggle.checked) {
    followOffset.copy(vp.offset);
    spectateCam.object3D.position.copy(player.object3D.position).add(followOffset);
    spectateCam.object3D.lookAt(player.object3D.position);
  } else {
    spectateCam.setAttribute('position', vp.position);
    spectateCam.setAttribute('rotation', vp.rotation);
  }
}

function setSpectateMode(enabled) {
  spectating = enabled;
  if (spectating) {
    // Render from the spectator camera but continue using the player camera to
    // capture mouse rotation. This keeps the avatar responsive while the
    // viewpoint remains fixed in space.
    if (spectateCam.components['look-controls']) {
      spectateCam.components['look-controls'].pause();
    }
    if (playerCamera.components['look-controls']) {
      playerCamera.components['look-controls'].play();
    }
    playerCamera.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('camera', 'active', true);
    spectateCam.setAttribute('visible', true);
    viewCamera = spectateCam;
    avatar.setAttribute('visible', true); // show local avatar while spectating
    applyViewpoint();
    debugLog('Spectate mode enabled');
  } else {
    // Return the view to the first-person camera. Look-controls stay active so
    // mouse rotation always drives the avatar.
    if (spectateCam.components['look-controls']) {
      spectateCam.components['look-controls'].pause();
    }
    if (playerCamera.components['look-controls']) {
      playerCamera.components['look-controls'].play();
    }
    spectateCam.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('visible', false);
    playerCamera.setAttribute('camera', 'active', true);
    viewCamera = playerCamera;
    avatar.setAttribute('visible', false); // hide avatar for first-person view
    debugLog('Spectate mode disabled');
  }
  spectateToggle.checked = spectating;
  updateStatus();
}

function updateStatus() {
  const pos = viewCamera.object3D.position;
  statusEl.textContent = `Mode: ${spectating ? 'Spectate' : 'First-person'} | Camera: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
}

spectateToggle.addEventListener('change', () => setSpectateMode(spectateToggle.checked));
fixCameraToggle.addEventListener('change', () => { applyViewpoint(); updateStatus(); });
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

  // Mirror the active camera's rotation on the avatar so it visually matches the
  // viewer's perspective without rotating the parent entity (avoids compounded
  // axes in first-person mode).
  // Mirror the controlling camera's rotation on the avatar so it matches the
  // user's view regardless of the render camera.
  avatar.object3D.rotation.copy(controlCamera.object3D.rotation);

  const dir = new THREE.Vector3();
  if (keys.w) dir.z -= 1;
  if (keys.s) dir.z += 1;
  if (keys.a) dir.x -= 1;
  if (keys.d) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      // Apply the controlling camera's yaw so movement is relative to the view
      const yaw = controlCamera.object3D.rotation.y;
      dir.applyEuler(new THREE.Euler(0, yaw, 0));
      player.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
    }

  if (spectating && fixCameraToggle.checked) {
    spectateCam.object3D.position.copy(player.object3D.position).add(followOffset);
    spectateCam.object3D.lookAt(player.object3D.position);
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

// Send current position and viewing direction to the server. Using the active
// camera's rotation avoids first-person axis issues and keeps the remote avatar
// aligned with the local view.
setInterval(() => {
  const position = player.getAttribute('position');
  // Send the orientation derived from the control camera so other clients see
  // the avatar's true facing direction when spectating.
  const rotation = controlCamera.getAttribute('rotation');
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
