// Client-side script for Mingle prototype
// Captures webcam stream and sends avatar position to server for simple synchronization.

// Establish socket connection to the server and cache DOM references.
const socket = io();
const avatar = document.getElementById('avatar');
const player = document.getElementById('player');
const playerCamera = document.getElementById('playerCamera');
const spectateCam = document.getElementById('spectateCam');
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
});

// Debug: log connection status
socket.on('connect', () => debugLog('Connected to server', socket.id));

// ---------------------------------------------------------------------------
// Custom movement handling
// ---------------------------------------------------------------------------
// Track the state of movement keys so that we can drive the player entity
// manually. This avoids relying on A-Frame's wasd-controls which depend on the
// currently active camera and caused erratic movement when spectating.
const keys = { w: false, a: false, s: false, d: false };
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = true;
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
});

// Move the player a tiny amount each frame based on the pressed keys. Movement
// is calculated relative to the player camera's yaw so that controls behave the
// same whether in first-person or spectate mode.
const MOVE_SPEED = 2; // metres per second
let lastMove = performance.now();
function movementLoop(time) {
  const dt = (time - lastMove) / 1000;
  lastMove = time;

  // Keep the player's rotation perfectly in sync with the camera so the avatar
  // pitches and yaws exactly with mouse movement.
  player.object3D.rotation.copy(playerCamera.object3D.rotation);

  const dir = new THREE.Vector3();
  if (keys.w) dir.z -= 1;
  if (keys.s) dir.z += 1;
  if (keys.a) dir.x -= 1;
  if (keys.d) dir.x += 1;

  if (dir.lengthSq() > 0) {
    dir.normalize();
    // Apply the player's current yaw so movement is relative to facing
    const yaw = player.object3D.rotation.y;
    dir.applyEuler(new THREE.Euler(0, yaw, 0));
    player.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
  }

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

// Send current position to server at regular intervals. The player's rotation is
// driven by the camera's look-controls, so we copy that rotation onto the player
// entity before broadcasting.
setInterval(() => {
  const position = player.getAttribute('position');
  const rotation = player.getAttribute('rotation');
  socket.emit('position', { position, rotation });
}, 100);

// Toggle spectate mode by pressing 'p'. When enabled the main camera is switched
// to a fixed spectator view but controls still move the hidden player avatar.
let spectating = false;
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'p') {
    spectating = !spectating;
    if (spectating) {
      playerCamera.setAttribute('camera', 'active', false);
      spectateCam.setAttribute('camera', 'active', true);
      spectateCam.setAttribute('visible', true);
      avatar.setAttribute('visible', true); // show local avatar while spectating
      debugLog('Spectate mode enabled');
    } else {
      spectateCam.setAttribute('camera', 'active', false);
      spectateCam.setAttribute('visible', false);
      playerCamera.setAttribute('camera', 'active', true);
      avatar.setAttribute('visible', false); // hide avatar for first-person view
      debugLog('Spectate mode disabled');
    }
  }
});

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
