/**
 * mingle_client.js
 * Mini README:
 * - Purpose: entry module initialising sockets, DOM references and helper
 *   modules for the Mingle prototype client.
 * - Structure:
 *   1. Socket and DOM setup
 *   2. Scene load debugging and HTTPS warning
 *   3. Module initialisation (UI controls, WebRTC, movement)
 * - Notes: Uses ES modules for clearer separation of concerns.
 */
import { initUIControls, setConnectedClients } from './ui_controls.js';
import { initMovement } from './movement.js';
import { initWebRTC } from './webrtc.js';
import { debugLog, debugError } from './utils.js';

// Establish socket connection and cache DOM references.
// The Socket.IO client may be absent if scripts are loaded out of order or omitted.
// Guard the creation to prevent runtime exceptions in such cases.
const socket = window.io ? io() : null;
if (!socket) console.error('Socket.IO client missing');
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

// Randomise starting location slightly so newcomers do not overlap.
const startPos = { x: Math.random() * 4 - 2, y: 1.6, z: Math.random() * 4 - 2 };
player.setAttribute('position', startPos);

// Warn when not using HTTPS as webcams and sensors require secure contexts.
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
  document.getElementById('instructions').innerHTML +=
    '<p><strong>HTTPS required:</strong> Access this site over HTTPS to enable the webcam, VR mode and device sensors.</p>';
  debugLog('Insecure context detected; camera and sensors disabled until HTTPS is used.');
}

// Assign a unique colour used for avatar backing and spectate marker.
const playerColor = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
avatarBack.setAttribute('color', playerColor);
spectateMarker.setAttribute('color', playerColor);

const sceneEl = document.querySelector('a-scene');
sceneEl.addEventListener('loaded', () => {
  debugLog('A-Frame scene loaded');
  if (spectateCam.components['look-controls']) {
    spectateCam.components['look-controls'].pause();
  }
  if (playerCamera.components['look-controls']) {
    playerCamera.components['look-controls'].play();
  }
});

if (socket) {
  socket.on('connect', () => {
    debugLog('Connected to server', socket.id);
    document.getElementById('instructions').innerHTML += '<p>Connected to server.</p>';
  });
  socket.on('connect_error', err => {
    document.getElementById('instructions').innerHTML += '<p>Cannot reach server.</p>';
    debugError('Socket connection error', err);
  });
  socket.on('clientCount', count => {
    setConnectedClients(count);
  });
} else {
  console.warn('Networking disabled: Socket.IO client unavailable');
}

initUIControls({
  player,
  playerCamera,
  spectateCam,
  spectateMarker,
  spectateToggle,
  viewpointRadios,
  modeMenu,
  statusEl,
  avatar
});

if (socket) {
  // Attempt to start WebRTC; on failure fall back to movement-only mode.
  try {
    initWebRTC({ socket, sceneEl });
  } catch (err) {
    document.getElementById('instructions').innerHTML +=
      '<p>Webcam unavailable; running without video.</p>';
    debugError('WebRTC initialisation failed', err);
  }
  // Always initialise movement so the 3D scene remains interactive.
  initMovement({
    player,
    playerCamera,
    spectateCam,
    spectateMarker,
    avatar,
    socket,
    playerColor
  });
}
