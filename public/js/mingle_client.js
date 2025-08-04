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
  const camRotation = playerCamera.getAttribute('rotation');
  player.setAttribute('rotation', camRotation);
  const position = player.getAttribute('position');
  socket.emit('position', { position, rotation: camRotation });
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
      debugLog('Spectate mode enabled');
    } else {
      spectateCam.setAttribute('camera', 'active', false);
      spectateCam.setAttribute('visible', false);
      playerCamera.setAttribute('camera', 'active', true);
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
