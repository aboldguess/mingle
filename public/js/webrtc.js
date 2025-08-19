/**
 * webrtc.js
 * Mini README:
 * - Purpose: client-side helpers for handling remote WebRTC audio with
 *   positional playback for avatars.
 * - Structure:
 *   1. Utility helpers to locate or create audio elements and A-Frame sound
 *      entities for each remote participant.
 *   2. attachRemoteAudio(stream, id) entry point used by mingle_client.js to
 *      route incoming media streams into spatial audio sources.
 * - Audio entity: an <a-entity id="audio-entity-{id}"> with the `sound`
 *   component is appended beneath the matching remote avatar
 *   (id="avatar-{id}") so that audio follows that avatar in 3D space.
 */

/** Retrieve or create the DOM nodes needed for positional audio. */
function ensureAudioTargets(id) {
  const sceneEl = document.querySelector('a-scene');
  const assetsEl = sceneEl ? sceneEl.querySelector('a-assets') : null;
  if (!assetsEl) {
    debugError('A-Frame assets container not found; audio stream ignored');
    return {};
  }

  // Create or reuse an <audio> element for the remote stream.
  let audioEl = document.getElementById(`audio-${id}`);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `audio-${id}`;
    audioEl.autoplay = true;
    audioEl.crossOrigin = 'anonymous';
    assetsEl.appendChild(audioEl);
  }

  // Create or reuse the positional sound entity under the remote avatar.
  let soundEntity = document.getElementById(`audio-entity-${id}`);
  if (!soundEntity) {
    const avatar = document.getElementById(`avatar-${id}`);
    if (avatar) {
      soundEntity = document.createElement('a-entity');
      soundEntity.id = `audio-entity-${id}`;
      soundEntity.setAttribute('sound', `src: #audio-${id}; autoplay: true; positional: true`);
      avatar.appendChild(soundEntity);
    } else {
      debugError(`Remote avatar avatar-${id} not found; spatial audio disabled`);
    }
  }

  return { audioEl, soundEntity };
}

/** Attach a remote MediaStream to audio playback with debug logging. */
function attachRemoteAudio(stream, id) {
  const { audioEl } = ensureAudioTargets(id);
  if (!audioEl) {
    debugError('Failed to create audio element for remote stream', id);
    return;
  }

  audioEl.srcObject = stream;
  audioEl.play()
    .then(() => debugLog('Remote audio playing for', id))
    .catch(err => debugError('Remote audio playback failed', err));
}

// Expose helper to global scope so mingle_client.js can invoke it.
window.attachRemoteAudio = attachRemoteAudio;
