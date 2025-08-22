/**
 * webcam_preview.js
 * Mini README:
 * - Purpose: manage the on-screen local webcam thumbnail and allow
 *   users to hide or show their own feed.
 * - Structure:
 *   1. Wait for DOM readiness and cache required elements.
 *   2. Attach the local MediaStream to the preview once available.
 *   3. Toggle visibility via a minimise button with debug logging.
 * - Notes: depends on mingle_client.js to initialise #localVideo.
 */

// Initialise preview behaviour when the document is ready.
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('selfPreview');
  const toggle = document.getElementById('selfPreviewToggle');
  const previewVideo = document.getElementById('selfPreviewVideo');
  const localVideo = document.getElementById('localVideo');

  // Validate essential elements exist.
  if (!container || !toggle || !previewVideo || !localVideo) {
    if (typeof debugError === 'function') {
      debugError('Self-preview elements missing from DOM');
    } else {
      console.error('Self-preview elements missing from DOM');
    }
    return;
  }

  // Attach local stream to the thumbnail when ready.
  function attachPreview() {
    if (localVideo.srcObject && !previewVideo.srcObject) {
      previewVideo.srcObject = localVideo.srcObject;
      previewVideo.play().catch(err => {
        if (typeof debugError === 'function') {
          debugError('Preview playback failed', err);
        } else {
          console.error('Preview playback failed', err);
        }
      });
    }
  }

  if (localVideo.srcObject) {
    attachPreview();
  } else {
    localVideo.addEventListener('loadedmetadata', attachPreview);
  }

  // Toggle visibility via the minimise button.
  toggle.addEventListener('click', () => {
    container.classList.toggle('hidden');
    const hidden = container.classList.contains('hidden');
    toggle.textContent = hidden ? '+' : '\u2212';
    toggle.setAttribute('aria-label', hidden ? 'Show webcam preview' : 'Hide webcam preview');
    if (typeof debugLog === 'function') {
      debugLog(`Self-preview ${hidden ? 'hidden' : 'shown'}`);
    }
  });
});
