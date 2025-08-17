/**
 * movement.js
 * Mini README:
 * - Purpose: handle custom WASD movement and periodically sync player state
 *   with the server.
 * - Structure:
 *   1. Key state tracking
 *   2. Touch movement button handlers
 *   3. Frame-based movement loop
 *   4. Periodic position emission to the server
 * - Notes: Depends on ui_controls.js for current mode and status updates.
 */
import { MODE_LAKITU, MODE_SPECTATOR, getCurrentMode, updateStatus } from './ui_controls.js';
import { debugLog } from './utils.js';

export function initMovement({ player, playerCamera, spectateCam, spectateMarker, avatar, socket, playerColor }) {
  const keys = { w: false, a: false, s: false, d: false };

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k in keys) {
      e.preventDefault();
      keys[k] = true;
    }
  });
  document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k in keys) {
      e.preventDefault();
      keys[k] = false;
    }
  });

  // Bind on-screen movement buttons for touch interfaces
  const btnForward = document.getElementById('moveForward');
  const btnBackward = document.getElementById('moveBackward');
  const btnLeft = document.getElementById('moveLeft');
  const btnRight = document.getElementById('moveRight');

  const bindButton = (btn, key) => {
    if (!btn) return;
    const activate = e => {
      e.preventDefault();
      keys[key] = true;
      debugLog(`Button ${key} pressed`);
    };
    const deactivate = e => {
      e.preventDefault();
      keys[key] = false;
      debugLog(`Button ${key} released`);
    };
    btn.addEventListener('pointerdown', activate);
    btn.addEventListener('pointerup', deactivate);
    btn.addEventListener('pointerleave', deactivate);
    btn.addEventListener('pointercancel', deactivate);
  };

  bindButton(btnForward, 'w');
  bindButton(btnBackward, 's');
  bindButton(btnLeft, 'a');
  bindButton(btnRight, 'd');

  const MOVE_SPEED = 2; // metres per second
  let lastMove = performance.now();
  function movementLoop(time) {
    const dt = (time - lastMove) / 1000;
    lastMove = time;

    const mode = getCurrentMode();
    if (!mode) {
      requestAnimationFrame(movementLoop);
      return;
    }

    if (mode !== MODE_LAKITU) {
      avatar.object3D.rotation.copy(playerCamera.object3D.rotation);
    }

    const dir = new THREE.Vector3();
    if (keys.w) dir.z -= 1;
    if (keys.s) dir.z += 1;
    if (keys.a) dir.x -= 1;
    if (keys.d) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      const yaw = playerCamera.object3D.rotation.y;
      dir.applyEuler(new THREE.Euler(0, yaw, 0));
      if (mode === MODE_LAKITU) {
        playerCamera.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
      } else if (mode === MODE_SPECTATOR) {
        spectateCam.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
        spectateMarker.object3D.position.copy(spectateCam.object3D.position);
        debugLog('Spectator camera moved to', spectateCam.object3D.position);
      } else {
        player.object3D.position.addScaledVector(dir, MOVE_SPEED * dt);
      }
    }

    if (mode === MODE_SPECTATOR) {
      const dist = spectateCam.object3D.position.distanceTo(player.object3D.position);
      if (dist > 0.1) {
        spectateCam.object3D.lookAt(player.object3D.position);
      }
    }

    updateStatus();
    requestAnimationFrame(movementLoop);
  }
  requestAnimationFrame(movementLoop);

  setInterval(() => {
    const position = player.getAttribute('position');
    const rotation = playerCamera.getAttribute('rotation');
    const spectatePos = getCurrentMode() === MODE_SPECTATOR ? spectateCam.getAttribute('position') : null;
    socket.emit('position', { position, rotation, color: playerColor, spectatePos });
  }, 100);
}
