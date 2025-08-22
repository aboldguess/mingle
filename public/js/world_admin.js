/**
 * world_admin.js
 * Mini README:
 * - Purpose: handle world configuration form interactions for administrators,
 *   manage avatar asset uploads and placement.
 * - Structure:
 *   1. Helper debug logger
 *   2. Load existing config when requested
 *   3. Submit updates back to the server
 *   4. Handle world design (geometry and colour) fields
 *   5. Upload body and TV models with scale and screen-region preview
 *   6. List uploaded assets with thumbnails
 *   7. Three.js preview for body/TV alignment and saving placement
 * - Notes: requires the admin token set on the server. Token is provided via the form.
*/
function adminDebugLog(...args) {
  if (window.MINGLE_DEBUG) {
    console.log(...args);
  }
}

const tokenInput = document.getElementById('token');
const worldNameInput = document.getElementById('worldName');
const maxParticipantsInput = document.getElementById('maxParticipants');
const welcomeMessageInput = document.getElementById('welcomeMessage');
const worldGeometrySelect = document.getElementById('worldGeometry');
const worldColorInput = document.getElementById('worldColor');

async function loadConfig() {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  try {
    const res = await fetch('/world-config', {
      headers: { 'x-admin-token': token },
    });
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    worldNameInput.value = data.worldName;
    maxParticipantsInput.value = data.maxParticipants;
    welcomeMessageInput.value = data.welcomeMessage;
    worldGeometrySelect.value = data.worldGeometry || 'plane';
    worldColorInput.value = data.worldColor || '#00aaff';
    adminDebugLog('Loaded config', data);
  } catch (err) {
    console.error(err);
    alert('Unable to load configuration');
  }
}

document.getElementById('loadBtn').addEventListener('click', loadConfig);

async function saveConfig() {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  const body = {
    worldName: worldNameInput.value.trim(),
    maxParticipants: Number(maxParticipantsInput.value),
    welcomeMessage: welcomeMessageInput.value.trim(),
    worldGeometry: worldGeometrySelect.value,
    worldColor: worldColorInput.value,
  };
  try {
    const res = await fetch('/world-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': token,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to save');
    adminDebugLog('Saved config', body);
    alert('Configuration saved');
  } catch (err) {
    console.error(err);
    alert('Unable to save configuration');
  }
}

document.getElementById('saveBtn').addEventListener('click', saveConfig);

// ---------------------------------------------------------------------------
// Avatar asset uploads
// ---------------------------------------------------------------------------
const bodyFileInput = document.getElementById('bodyFile');
const bodyScaleInput = document.getElementById('bodyScale');
const uploadBodyBtn = document.getElementById('uploadBodyBtn');
const tvFileInput = document.getElementById('tvFile');
const tvScaleInput = document.getElementById('tvScale');
const screenXInput = document.getElementById('screenX');
const screenYInput = document.getElementById('screenY');
const screenWInput = document.getElementById('screenW');
const screenHInput = document.getElementById('screenH');
const screenPreview = document.getElementById('screenPreview');
const uploadTVBtn = document.getElementById('uploadTVBtn');

function drawPreview() {
  if (!screenPreview || !screenPreview.getContext) {
    return;
  }
  const ctx = screenPreview.getContext('2d');
  const w = screenPreview.width;
  const h = screenPreview.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#ccc';
  ctx.strokeRect(0, 0, w, h);
  const x = Number(screenXInput.value) || 0;
  const y = Number(screenYInput.value) || 0;
  const rw = Number(screenWInput.value) || 1;
  const rh = Number(screenHInput.value) || 1;
  ctx.fillStyle = 'rgba(0,150,255,0.3)';
  ctx.fillRect(x * w, (1 - y - rh) * h, rw * w, rh * h);
}

[screenXInput, screenYInput, screenWInput, screenHInput].forEach(input => {
  if (input) {
    input.addEventListener('input', drawPreview);
  }
});
drawPreview();

async function uploadAsset(type) {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  const form = new FormData();
  form.append('type', type);
  let file = null;
  if (type === 'body') {
    file = bodyFileInput.files[0];
    form.append('scale', bodyScaleInput.value || '1');
  } else {
    file = tvFileInput.files[0];
    form.append('scale', tvScaleInput.value || '1');
    form.append('screenX', screenXInput.value || '0');
    form.append('screenY', screenYInput.value || '0');
    form.append('screenW', screenWInput.value || '1');
    form.append('screenH', screenHInput.value || '1');
  }
  if (!file) {
    alert('Select a .glb file');
    return;
  }
  form.append('model', file);
  try {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'x-admin-token': token },
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    adminDebugLog('Uploaded asset', data);
    alert('Asset uploaded');
  } catch (err) {
    console.error(err);
    alert('Upload failed');
  }
}

if (uploadBodyBtn) {
  uploadBodyBtn.addEventListener('click', () => uploadAsset('body'));
}
if (uploadTVBtn) {
  uploadTVBtn.addEventListener('click', () => uploadAsset('tv'));
}

// ---------------------------------------------------------------------------
// Asset listing and preview placement
// ---------------------------------------------------------------------------
const assetLists = document.getElementById('assetLists');
const previewCanvas = document.getElementById('previewCanvas');
const bodyScaleRange = document.getElementById('bodyScaleRange');
const tvScaleRange = document.getElementById('tvScaleRange');
const tvPosX = document.getElementById('tvPosX');
const tvPosY = document.getElementById('tvPosY');
const tvPosZ = document.getElementById('tvPosZ');
const savePlacementBtn = document.getElementById('savePlacementBtn');

let selectedBody = null;
let selectedTV = null;
let bodyMesh = null;
let tvMesh = null;
let videoTexture = null;

// Three.js renderer setup
let renderer = null;
let scene = null;
let camera = null;
let loader = null;
function initThree() {
  if (!previewCanvas) return;
  renderer = new THREE.WebGLRenderer({ canvas: previewCanvas, alpha: true });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, previewCanvas.width / previewCanvas.height, 0.1, 100);
  camera.position.set(0, 1.5, 3);
  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(light);
  loader = new THREE.GLTFLoader();
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}
initThree();

async function ensureVideoTexture() {
  if (videoTexture) return videoTexture;
  try {
    const video = document.createElement('video');
    video.autoplay = true;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    videoTexture = new THREE.VideoTexture(video);
    return videoTexture;
  } catch (err) {
    console.error('Webcam not available', err);
    return null;
  }
}

function updatePreview() {
  if (!selectedBody || !selectedTV || !loader) return;
  if (bodyMesh) scene.remove(bodyMesh);
  if (tvMesh) scene.remove(tvMesh);
  loader.load(`/assets/${selectedBody.filename}`, (g) => {
    bodyMesh = g.scene;
    bodyMesh.scale.setScalar(parseFloat(bodyScaleRange.value));
    scene.add(bodyMesh);
  });
  loader.load(`/assets/${selectedTV.filename}`, async (g) => {
    tvMesh = g.scene;
    tvMesh.scale.setScalar(parseFloat(tvScaleRange.value));
    tvMesh.position.set(parseFloat(tvPosX.value), parseFloat(tvPosY.value), parseFloat(tvPosZ.value));
    scene.add(tvMesh);
    const tex = await ensureVideoTexture();
    if (tex) {
      tex.needsUpdate = true;
      if (selectedTV.screen) {
        tex.offset.set(selectedTV.screen.x, 1 - selectedTV.screen.y - selectedTV.screen.height);
        tex.repeat.set(selectedTV.screen.width, selectedTV.screen.height);
      }
      tvMesh.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshBasicMaterial({ map: tex });
        }
      });
    }
  });
}

function renderAssetLists(manifest) {
  if (!assetLists) return;
  assetLists.innerHTML = '';
  const bodiesDiv = document.createElement('div');
  bodiesDiv.innerHTML = '<h4>Bodies</h4>';
  manifest.bodies.forEach((b) => {
    const viewer = document.createElement('model-viewer');
    viewer.src = `/assets/${b.filename}`;
    viewer.style.width = '100px';
    viewer.style.height = '100px';
    viewer.addEventListener('click', () => {
      selectedBody = b;
      bodyScaleRange.value = String(b.scale);
      updatePreview();
    });
    bodiesDiv.appendChild(viewer);
  });

  const tvsDiv = document.createElement('div');
  tvsDiv.innerHTML = '<h4>TVs</h4>';
  manifest.tvs.forEach((t) => {
    const wrapper = document.createElement('div');
    const viewer = document.createElement('model-viewer');
    viewer.src = `/assets/${t.filename}`;
    viewer.style.width = '100px';
    viewer.style.height = '100px';
    viewer.addEventListener('click', () => {
      selectedTV = t;
      tvScaleRange.value = String(t.scale);
      updatePreview();
    });
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit Screen';
    editBtn.addEventListener('click', () => editScreen(t));
    wrapper.appendChild(viewer);
    wrapper.appendChild(editBtn);
    tvsDiv.appendChild(wrapper);
  });
  assetLists.appendChild(bodiesDiv);
  assetLists.appendChild(tvsDiv);
}

async function loadAssetsAndConfig() {
  try {
    const res = await fetch('/api/assets');
    const manifest = await res.json();
    renderAssetLists(manifest);
  } catch (err) {
    console.error('Failed to load assets', err);
  }
}
loadAssetsAndConfig();

[bodyScaleRange, tvScaleRange].forEach((input) => {
  if (input) {
    input.addEventListener('input', () => {
      if (input === bodyScaleRange && bodyMesh) {
        bodyMesh.scale.setScalar(parseFloat(bodyScaleRange.value));
      }
      if (input === tvScaleRange && tvMesh) {
        tvMesh.scale.setScalar(parseFloat(tvScaleRange.value));
      }
    });
  }
});
[tvPosX, tvPosY, tvPosZ].forEach((input) => {
  if (input) {
    input.addEventListener('input', () => {
      if (tvMesh) {
        tvMesh.position.set(parseFloat(tvPosX.value), parseFloat(tvPosY.value), parseFloat(tvPosZ.value));
      }
    });
  }
});

async function savePlacement() {
  const token = tokenInput.value.trim();
  if (!token || !selectedBody || !selectedTV) {
    alert('Select token, body and TV');
    return;
  }
  try {
    await fetch(`/api/assets/body/${selectedBody.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ scale: parseFloat(bodyScaleRange.value) }),
    });
    await fetch(`/api/assets/tv/${selectedTV.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ scale: parseFloat(tvScaleRange.value) }),
    });
    const cfg = {
      defaultBodyId: selectedBody.id,
      defaultTvId: selectedTV.id,
      tvPosition: {
        x: parseFloat(tvPosX.value),
        y: parseFloat(tvPosY.value),
        z: parseFloat(tvPosZ.value),
      },
    };
    await fetch('/world-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify(cfg),
    });
    alert('Placement saved');
  } catch (err) {
    console.error('Save failed', err);
    alert('Save failed');
  }
}
if (savePlacementBtn) {
  savePlacementBtn.addEventListener('click', savePlacement);
}

// ---------------------------------------------------------------------------
// TV screen region editor using webcam preview
// ---------------------------------------------------------------------------
function editScreen(tv) {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.7)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';

  const panel = document.createElement('div');
  panel.style.background = '#fff';
  panel.style.padding = '10px';

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  const video = document.createElement('video');
  video.autoplay = true;
  video.width = 320;
  video.height = 240;
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  wrapper.appendChild(video);
  wrapper.appendChild(canvas);

  const controls = document.createElement('div');
  controls.innerHTML = '<p>Adjust screen region then save.</p>';
  const xInput = document.createElement('input');
  xInput.type = 'range'; xInput.min = '0'; xInput.max = '1'; xInput.step = '0.01';
  const yInput = document.createElement('input');
  yInput.type = 'range'; yInput.min = '0'; yInput.max = '1'; yInput.step = '0.01';
  const wInput = document.createElement('input');
  wInput.type = 'range'; wInput.min = '0'; wInput.max = '1'; wInput.step = '0.01';
  const hInput = document.createElement('input');
  hInput.type = 'range'; hInput.min = '0'; hInput.max = '1'; hInput.step = '0.01';
  [xInput, yInput, wInput, hInput].forEach((el) => (el.style.display = 'block'));
  xInput.value = tv.screen ? tv.screen.x : '0';
  yInput.value = tv.screen ? tv.screen.y : '0';
  wInput.value = tv.screen ? tv.screen.width : '1';
  hInput.value = tv.screen ? tv.screen.height : '1';

  function drawRect() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'red';
    const x = parseFloat(xInput.value) * canvas.width;
    const y = (1 - parseFloat(yInput.value) - parseFloat(hInput.value)) * canvas.height;
    const w = parseFloat(wInput.value) * canvas.width;
    const h = parseFloat(hInput.value) * canvas.height;
    ctx.strokeRect(x, y, w, h);
  }
  [xInput, yInput, wInput, hInput].forEach((el) => el.addEventListener('input', drawRect));
  drawRect();

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.marginLeft = '10px';
  controls.appendChild(xInput);
  controls.appendChild(yInput);
  controls.appendChild(wInput);
  controls.appendChild(hInput);
  controls.appendChild(saveBtn);
  controls.appendChild(cancelBtn);

  panel.appendChild(wrapper);
  panel.appendChild(controls);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
    video.srcObject = stream;
  }).catch((err) => console.error('Webcam error', err));

  saveBtn.addEventListener('click', async () => {
    const body = {
      screen: {
        x: parseFloat(xInput.value),
        y: parseFloat(yInput.value),
        width: parseFloat(wInput.value),
        height: parseFloat(hInput.value),
      },
    };
    try {
      await fetch(`/api/assets/tv/${tv.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(body),
      });
      tv.screen = body.screen;
      alert('Screen saved');
    } catch (err) {
      console.error('Screen save failed', err);
      alert('Save failed');
    }
    document.body.removeChild(overlay);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
}
