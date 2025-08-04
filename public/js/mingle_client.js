// Client-side script for Mingle prototype
// Captures webcam stream and sends avatar position to server for simple synchronization.

// Establish socket connection to the server and cache DOM references.
const socket = io();
const avatar = document.getElementById('avatar');
const cameraRig = document.getElementById('rig');

// Log when the A-Frame scene has finished initialising which helps debug
// stuck loading screens.
document.querySelector('a-scene').addEventListener('loaded', () => {
  console.log('A-Frame scene loaded');
});

// Debug: log connection status
socket.on('connect', () => console.log('Connected to server', socket.id));

// Capture webcam
navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then(stream => {
    const videoEl = document.getElementById('localVideo');

    // Attach the stream to the video element. Muting allows autoplay which
    // prevents the A-Frame loader from stalling waiting for the video.
    videoEl.muted = true;
    videoEl.srcObject = stream;
    videoEl.onloadeddata = () => console.log('Webcam video element loaded');

    // Some browsers require an explicit play() call. Log success/failure for
    // easier debugging.
    videoEl.play()
      .then(() => console.log('Webcam stream started'))
      .catch(err => console.error('Webcam playback failed', err));
  })
  .catch(err => console.error('Could not start webcam', err));

// Send current position to server at regular intervals
setInterval(() => {
  const position = cameraRig.getAttribute('position');
  const rotation = cameraRig.getAttribute('rotation');
  socket.emit('position', { position, rotation });
}, 100);

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
});

socket.on('disconnectClient', id => {
  const box = remotes[id];
  if (box) {
    box.parentNode.removeChild(box);
    delete remotes[id];
  }
});
