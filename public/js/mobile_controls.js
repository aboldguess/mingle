/**
 * mobile_controls.js
 * Mini README:
 * - Purpose: provide touch-friendly joystick controls for movement and optional
 *   manual camera panning on mobile devices.
 * - Structure:
 *   1. Initialise left thumbstick to mirror WASD movement keys.
 *   2. Toggleable right thumbstick for manual camera pan/tilt when device
 *      orientation is undesirable.
 *   3. Animation loop applying look deltas to the player camera.
 * - Notes: Requires mingle_client.js to define global `keys` and `playerCamera`.
 */

// Run after the DOM loads to ensure required elements exist.
document.addEventListener('DOMContentLoaded', () => {
  // Skip setup on non-touch devices where keyboard and mouse are available.
  if (!('ontouchstart' in window)) {
    return;
  }

  const moveZone = document.getElementById('moveJoystick');
  const lookZone = document.getElementById('lookJoystick');
  const lookToggle = document.getElementById('lookToggle');

  if (!moveZone || !lookZone || !lookToggle) {
    if (typeof debugError === 'function') {
      debugError('Mobile controls: required DOM elements not found');
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Movement joystick mirrors WASD key state
  // -------------------------------------------------------------------------
  const moveStick = nipplejs.create({
    zone: moveZone,
    mode: 'static',
    position: { left: '60px', bottom: '60px' },
    color: 'white'
  });

  moveStick.on('move', (evt, data) => {
    const dead = 0.3; // ignore tiny movements
    const x = data.vector.x;
    const y = data.vector.y;
    keys.w = y < -dead;
    keys.s = y > dead;
    keys.a = x < -dead;
    keys.d = x > dead;
  });
  moveStick.on('end', () => {
    keys.w = keys.a = keys.s = keys.d = false;
  });

  if (typeof debugLog === 'function') {
    debugLog('Movement joystick initialised');
  }

  // -------------------------------------------------------------------------
  // Optional look joystick for manual pan/tilt
  // -------------------------------------------------------------------------
  let lookStick = null;
  let manualLook = false;
  const lookDelta = { x: 0, y: 0 };
  const LOOK_SPEED = 1.5; // radians per second
  let lastLook = performance.now();

  function updateLook(t) {
    const dt = (t - lastLook) / 1000;
    lastLook = t;
    if (manualLook) {
      const rot = playerCamera.object3D.rotation;
      rot.y -= lookDelta.x * LOOK_SPEED * dt;
      rot.x -= lookDelta.y * LOOK_SPEED * dt;
      // Clamp pitch to avoid flipping
      rot.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rot.x));
    }
    requestAnimationFrame(updateLook);
  }
  requestAnimationFrame(updateLook);

  function enableLookStick() {
    manualLook = true;
    lookZone.style.display = 'block';
    if (playerCamera.components['look-controls']) {
      playerCamera.components['look-controls'].pause();
    }
    lookStick = nipplejs.create({
      zone: lookZone,
      mode: 'static',
      position: { right: '60px', bottom: '60px' },
      color: 'white'
    });
    lookStick.on('move', (evt, data) => {
      lookDelta.x = data.vector.x;
      lookDelta.y = data.vector.y;
    });
    lookStick.on('end', () => {
      lookDelta.x = 0;
      lookDelta.y = 0;
    });
    if (typeof debugLog === 'function') {
      debugLog('Look joystick enabled');
    }
  }

  function disableLookStick() {
    manualLook = false;
    lookZone.style.display = 'none';
    lookDelta.x = lookDelta.y = 0;
    if (lookStick) {
      lookStick.destroy();
      lookStick = null;
    }
    if (playerCamera.components['look-controls']) {
      playerCamera.components['look-controls'].play();
    }
    if (typeof debugLog === 'function') {
      debugLog('Look joystick disabled');
    }
  }

  // Toggle based on checkbox state
  lookToggle.addEventListener('change', () => {
    if (lookToggle.checked) {
      enableLookStick();
    } else {
      disableLookStick();
    }
  });
});
