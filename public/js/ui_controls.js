/**
 * ui_controls.js
 * Mini README:
 * - Purpose: manage user interface interactions including mode selection,
 *   spectate toggling, viewpoint changes and status updates.
 * - Structure:
 *   1. Mode constants and internal state
 *   2. initUIControls() to wire DOM events (mode selection via delegation)
 *   3. Helpers for spectate mode and viewpoints
 *   4. Status display and client count management
 * - Notes:
 *   - Spectate toggle and viewpoint radios are optional; listeners attach only
 *     when present.
 *   - Required elements missing during init will surface an on-screen error.
 *   - Exports helpers so other modules can query the current mode and active
 *     camera for movement and networking logic.
 */
import { debugLog } from './utils.js';

export const MODE_FPV = 'FPV';
export const MODE_SPECTATOR = 'Spectator';
export const MODE_LAKITU = 'Lakitu';

let player;
let playerCamera;
let spectateCam;
let spectateMarker;
let spectateToggle;
let viewpointRadios;
let modeMenu;
let statusEl;
let avatar;

let currentMode = null;
let spectating = false;
let currentView = 'high';
let connectedClients = 1;
let activeCamera;

const VIEWPOINTS = {
  high: { position: { x: 10, y: 10, z: 10 }, rotation: { x: -35, y: -45, z: 0 } },
  ground: { position: { x: 10, y: 1.6, z: 10 }, rotation: { x: 0, y: -45, z: 0 } },
  top: { position: { x: 0, y: 20, z: 0 }, rotation: { x: -90, y: 0, z: 0 } }
};

export function initUIControls(opts) {
  ({
    player,
    playerCamera,
    spectateCam,
    spectateMarker,
    spectateToggle,
    viewpointRadios,
    modeMenu,
    statusEl,
    avatar
  } = opts);

  // Optional dependencies are normalised to null when absent/empty so later
  // code can safely check their presence.
  viewpointRadios = viewpointRadios && viewpointRadios.length ? viewpointRadios : null;

  // Validate required DOM elements before wiring listeners. Optional elements
  // (spectateToggle & viewpointRadios) won't block initialisation.
  const requiredDeps = {
    player,
    playerCamera,
    spectateCam,
    spectateMarker,
    modeMenu,
    statusEl,
    avatar
  };
  const missing = Object.entries(requiredDeps)
    .filter(([, val]) => !val)
    .map(([name]) => name);
  missing.forEach(name => console.error(`initUIControls: missing ${name}`));
  if (missing.length) {
    // Surface an on-screen message to aid end users when init fails.
    const msg = document.createElement('div');
    msg.textContent = `Client failed to initialise: missing ${missing.join(', ')}`;
    msg.style.position = 'absolute';
    msg.style.top = '0';
    msg.style.left = '0';
    msg.style.right = '0';
    msg.style.background = '#ff4d4f';
    msg.style.color = '#fff';
    msg.style.padding = '1em';
    msg.style.textAlign = 'center';
    msg.style.zIndex = '1000';
    document.body.appendChild(msg);
    console.warn('initUIControls aborted: required dependencies missing');
    return;
  }

  activeCamera = playerCamera;
  spectateCam.setAttribute('wasd-controls', 'enabled', false);

  // Wire up explicit handlers for each mode selection button. Delegated
  // listeners on the container failed in some embedded browsers, leaving the
  // menu unresponsive. Direct listeners ensure clicks always register.
  const buttons = modeMenu.querySelectorAll('button[data-mode]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      debugLog('Mode button clicked', btn.dataset.mode);
      selectMode(btn.dataset.mode);
    });
  });

  // Attach optional UI listeners only when those controls exist on the page.
  if (spectateToggle) {
    spectateToggle.addEventListener('change', () => {
      if (currentMode === MODE_LAKITU) {
        spectateToggle.checked = false;
        return;
      }
      setSpectateMode(spectateToggle.checked);
      currentMode = spectating ? MODE_SPECTATOR : MODE_FPV;
      updateStatus();
    });
  }

  if (viewpointRadios) {
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
  }

  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'p' && currentMode !== MODE_LAKITU) {
      setSpectateMode(!spectating);
      currentMode = spectating ? MODE_SPECTATOR : MODE_FPV;
      updateStatus();
    }
  });

  updateStatus();
}

function applyViewpoint() {
  const vp = VIEWPOINTS[currentView];
  spectateCam.setAttribute('position', vp.position);
  spectateCam.setAttribute('rotation', vp.rotation);
  spectateMarker.setAttribute('position', vp.position);
}

function setSpectateMode(enabled) {
  spectating = enabled;
  if (spectating) {
    playerCamera.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('camera', 'active', true);
    spectateCam.setAttribute('visible', true);
    spectateMarker.setAttribute('visible', true);
    activeCamera = spectateCam;
    avatar.setAttribute('visible', true);
    applyViewpoint();
    if (spectateCam.components['look-controls']) {
      spectateCam.components['look-controls'].pause();
    }
    if (playerCamera.components['look-controls']) {
      playerCamera.components['look-controls'].play();
    }
    debugLog('Spectate mode enabled');
  } else {
    spectateCam.setAttribute('camera', 'active', false);
    spectateCam.setAttribute('visible', false);
    spectateMarker.setAttribute('visible', false);
    playerCamera.setAttribute('camera', 'active', true);
    activeCamera = playerCamera;
    avatar.setAttribute('visible', false);
    if (spectateCam.components['look-controls']) {
      spectateCam.components['look-controls'].pause();
    }
    debugLog('Spectate mode disabled');
  }
  if (spectateToggle) {
    spectateToggle.checked = spectating;
  }
}

function selectMode(mode) {
  currentMode = mode === 'fpv' ? MODE_FPV : mode === 'spectator' ? MODE_SPECTATOR : MODE_LAKITU;
  modeMenu.classList.add('hidden');
  debugLog('Mode selected', currentMode);

  player.setAttribute('position', { x: 0, y: 1.6, z: 0 });
  playerCamera.setAttribute('position', { x: 0, y: 0, z: 0 });

  if (currentMode === MODE_SPECTATOR) {
    setSpectateMode(true);
    spectateCam.setAttribute('position', VIEWPOINTS.high.position);
  } else if (currentMode === MODE_LAKITU) {
    setSpectateMode(false);
    avatar.setAttribute('visible', true);
    playerCamera.setAttribute('position', { x: 0, y: 0, z: 3 });
    playerCamera.object3D.lookAt(player.object3D.position);
  } else {
    setSpectateMode(false);
  }
  updateStatus();
}

export function getCurrentMode() {
  return currentMode;
}

export function getActiveCamera() {
  return activeCamera;
}

export function setConnectedClients(count) {
  connectedClients = count;
  updateStatus();
}

export function updateStatus() {
  if (!currentMode) {
    statusEl.textContent = `Mode: (select) | Users: ${connectedClients}`;
    return;
  }
  const pos = activeCamera.object3D.position;
  statusEl.textContent = `Mode: ${currentMode} | Camera: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)} | Users: ${connectedClients}`;
}
