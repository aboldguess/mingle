/**
 * webrtc.js
 * Mini README:
 * - Purpose: establish webcam capture, manage WebRTC peer connections and render
 *   remote avatars with video textures.
 * - Structure:
 *   1. Local webcam initialisation
 *   2. Socket signalling handlers for WebRTC
 *   3. Remote avatar creation and cleanup
 * - Notes: Designed to be invoked once with socket and scene references.
 */
import { debugLog, debugError } from './utils.js';

export function initWebRTC({ socket, sceneEl }) {
  const assetsEl = sceneEl.querySelector('a-assets');
  const peerConnections = {};
  const remotes = {};

  const localStreamPromise = navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then(stream => {
      const videoEl = document.getElementById('localVideo');
      videoEl.muted = true;
      videoEl.srcObject = stream;
      // Hide the element to avoid displaying the raw feed if the A-Frame scene
      // fails to initialise and <a-assets> remains visible.
      videoEl.style.display = 'none';
     videoEl.onloadeddata = () => debugLog('Webcam video element loaded');
      return videoEl.play()
        .then(() => { debugLog('Webcam stream started'); return stream; })
        .catch(err => { debugError('Webcam playback failed', err); return stream; });
    })
    .catch(err => {
      debugError('Could not start webcam', err);
      document.getElementById('instructions').innerHTML += '<p>Webcam unavailable. Check camera permissions.</p>';
      throw err;
    });

  socket.on('rtc-offer', async ({ from, offer }) => {
    debugLog('Received RTC offer from', from);
    const pc = peerConnections[from] || await createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('rtc-answer', { to: from, answer });
  });

  socket.on('rtc-answer', async ({ from, answer }) => {
    debugLog('Received RTC answer from', from);
    const pc = peerConnections[from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  socket.on('ice-candidate', ({ from, candidate }) => {
    const pc = peerConnections[from];
    if (pc && candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => debugError('ICE add error', err));
    }
  });

  async function createPeerConnection(id) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerConnections[id] = pc;

    try {
      const stream = await localStreamPromise;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    } catch (err) {
      debugError('Local stream unavailable for peer connection', err);
    }

    pc.ontrack = event => {
      // Locate or lazily create the corresponding video element. In rare cases
      // the remote stream can arrive before the <video> element is added to the
      // DOM (e.g. if signalling completes extremely quickly). Creating it here
      // prevents the stream from being lost and ensures every peer's feed is
      // rendered.
      let videoEl = document.getElementById(`video-${id}`);
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.id = `video-${id}`;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.style.display = 'none';
        assetsEl.appendChild(videoEl);
      }
      videoEl.srcObject = event.streams[0];
      videoEl.play().catch(err => debugError('Remote video playback failed', err));
    };

    pc.onicecandidate = event => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: id, candidate: event.candidate });
      }
    };

    return pc;
  }

  socket.on('position', async data => {
    if (data.id === socket.id) { return; }

    let remote = remotes[data.id];
    if (!remote) {
      const avatarEntity = document.createElement('a-entity');

      const videoEl = document.createElement('video');
      videoEl.id = `video-${data.id}`;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = true;
      // Ensure remote video elements never leak onto the page should A-Frame
      // fail to hide <a-assets> when blocked by CSP or similar issues.
      videoEl.style.display = 'none';
      assetsEl.appendChild(videoEl);

      const front = document.createElement('a-plane');
      front.setAttribute('width', 1);
      front.setAttribute('height', 1);
      front.setAttribute('position', '0 0 -0.05');
      front.setAttribute('rotation', '0 180 0');
      front.setAttribute('material', `src:#${videoEl.id}`);

      const back = document.createElement('a-plane');
      back.setAttribute('width', 1);
      back.setAttribute('height', 1);
      back.setAttribute('position', '0 0 0.05');
      back.setAttribute('color', '#FFFFFF');

      avatarEntity.appendChild(front);
      avatarEntity.appendChild(back);

      const camBox = document.createElement('a-box');
      camBox.setAttribute('color', data.color || '#888888');
      camBox.setAttribute('width', 0.5);
      camBox.setAttribute('height', 0.5);
      camBox.setAttribute('depth', 0.5);
      camBox.setAttribute('visible', false);

      sceneEl.appendChild(avatarEntity);
      sceneEl.appendChild(camBox);
      remotes[data.id] = { avatar: avatarEntity, cam: camBox };
      remote = remotes[data.id];
      debugLog('Remote avatar created for', data.id);
    }

    if (!peerConnections[data.id]) {
      const pc = await createPeerConnection(data.id);
      if (socket.id < data.id) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('rtc-offer', { to: data.id, offer: pc.localDescription });
          debugLog('Sent RTC offer to', data.id);
        } catch (err) {
          debugError('Failed to create offer', err);
        }
      }
    }

    remote.avatar.setAttribute('position', data.position);
    remote.avatar.setAttribute('rotation', data.rotation);
    if (data.spectatePos) {
      remote.cam.setAttribute('position', data.spectatePos);
      remote.cam.setAttribute('visible', true);
    } else {
      remote.cam.setAttribute('visible', false);
    }
  });

  socket.on('disconnectClient', id => {
    const remote = remotes[id];
    if (remote) {
      remote.avatar.parentNode.removeChild(remote.avatar);
      remote.cam.parentNode.removeChild(remote.cam);
      delete remotes[id];
    }
    if (peerConnections[id]) {
      peerConnections[id].close();
      delete peerConnections[id];
    }
    const vid = document.getElementById(`video-${id}`);
    if (vid && vid.parentNode) {
      vid.parentNode.removeChild(vid);
    }
  });
}
