/**
 * ui_controls.js
 * Mini README:
 * - Purpose: handle interactive sidebar controls such as the microphone mute toggle.
 * - Structure:
 *   1. Cache DOM elements and initialise status text when the document loads.
 *   2. Event listener that toggles the local audio track and updates on-screen state.
 * - Notes: Requires mingle_client.js to initialise the #localVideo stream beforehand.
 */

// Wait for the DOM to be ready before querying elements.
document.addEventListener('DOMContentLoaded', () => {
  const muteToggle = document.getElementById('muteToggle');
  const micStatus = document.getElementById('micStatus');

  // Ensure required elements exist to avoid runtime errors.
  if (!muteToggle || !micStatus) {
    if (typeof debugError === 'function') {
      debugError('Microphone controls not found in DOM');
    } else {
      console.error('Microphone controls not found in DOM');
    }
    return;
  }

  // Display initial microphone state for clarity.
  micStatus.textContent = 'Mic: live';

  // Toggle the local audio track whenever the checkbox changes.
  muteToggle.addEventListener('change', () => {
    const videoEl = document.getElementById('localVideo');
    const stream = videoEl ? videoEl.srcObject : null;
    const tracks = stream ? stream.getAudioTracks() : [];

    if (tracks.length === 0) {
      if (typeof debugError === 'function') {
        debugError('No local audio track available to toggle');
      } else {
        console.error('No local audio track available to toggle');
      }
      return;
    }

    // Enable or disable all audio tracks based on the checkbox state.
    const muted = muteToggle.checked;
    tracks.forEach(track => {
      track.enabled = !muted;
    });

    micStatus.textContent = muted ? 'Mic: muted' : 'Mic: live';

    if (typeof debugLog === 'function') {
      debugLog(`Microphone ${muted ? 'muted' : 'unmuted'}`);
    }
  });
});
