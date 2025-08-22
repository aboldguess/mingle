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
 *   5. Upload body and TV models
 *   6. List uploaded assets with metadata, selection radios and delete controls
 *   7. Three.js preview for aligning TV and webcam canvas before saving
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
    if (data.tvPosition) {
      tvPosX.value = String(data.tvPosition.x);
      tvPosY.value = String(data.tvPosition.y);
      tvPosZ.value = String(data.tvPosition.z);
    }
    if (data.webcamOffset) {
      camPosX.value = String(data.webcamOffset.x);
      camPosY.value = String(data.webcamOffset.y);
      camPosZ.value = String(data.webcamOffset.z);
      camScaleRange.value = String(data.webcamOffset.scale);
    }
    if (currentManifest) {
      selectedBody = currentManifest.bodies.find(b => b.id === data.defaultBodyId) || null;
      selectedTV = currentManifest.tvs.find(t => t.id === data.defaultTvId) || null;
      if (selectedTV) {
        tvScaleRange.value = String(selectedTV.scale);
      }
      updatePreview();
    }
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
// Avatar asset uploads and preview management
// ---------------------------------------------------------------------------
const bodyFileInput = document.getElementById('bodyFile');
const uploadBodyBtn = document.getElementById('uploadBodyBtn');
const tvFileInput = document.getElementById('tvFile');
const uploadTVBtn = document.getElementById('uploadTVBtn');
const bodyList = document.getElementById('bodyList');
const tvList = document.getElementById('tvList');
const previewCanvas = document.getElementById('previewCanvas');
const tvScaleRange = document.getElementById('tvScaleRange');
const tvPosX = document.getElementById('tvPosX');
const tvPosY = document.getElementById('tvPosY');
const tvPosZ = document.getElementById('tvPosZ');
const camPosX = document.getElementById('camPosX');
const camPosY = document.getElementById('camPosY');
const camPosZ = document.getElementById('camPosZ');
const camScaleRange = document.getElementById('camScaleRange');
const savePlacementBtn = document.getElementById('savePlacementBtn');

let currentManifest = null;
let selectedBody = null;
let selectedTV = null;
let bodyMesh = null;
let tvGroup = null;
let tvMesh = null;
let camPlane = null;
let videoTexture = null;

// Three.js renderer setup for the preview pane
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

function clearScene() {
  if (bodyMesh) scene.remove(bodyMesh);
  if (tvGroup) scene.remove(tvGroup);
  bodyMesh = null;
  tvGroup = null;
  tvMesh = null;
  camPlane = null;
}

function updatePreview() {
  if (!selectedBody || !selectedTV || !loader) return;
  clearScene();
  loader.load(`/assets/${selectedBody.filename}`, (g) => {
    bodyMesh = g.scene;
    bodyMesh.scale.setScalar(selectedBody.scale);
    scene.add(bodyMesh);
  });
  loader.load(`/assets/${selectedTV.filename}`, async (g) => {
    tvMesh = g.scene;
    tvGroup = new THREE.Group();
    tvGroup.add(tvMesh);
    tvGroup.position.set(parseFloat(tvPosX.value), parseFloat(tvPosY.value), parseFloat(tvPosZ.value));
    tvGroup.scale.setScalar(parseFloat(tvScaleRange.value));
    scene.add(tvGroup);
    const tex = await ensureVideoTexture();
    if (tex) {
      tex.needsUpdate = true;
      const planeGeom = new THREE.PlaneGeometry(1, 1);
      const planeMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      camPlane = new THREE.Mesh(planeGeom, planeMat);
      camPlane.position.set(parseFloat(camPosX.value), parseFloat(camPosY.value), parseFloat(camPosZ.value));
      camPlane.scale.setScalar(parseFloat(camScaleRange.value));
      tvGroup.add(camPlane);
    }
  });
}

async function uploadAsset(type) {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  const form = new FormData();
  const file = type === 'body' ? bodyFileInput.files[0] : tvFileInput.files[0];
  if (!file) {
    alert('Select a .glb file');
    return;
  }
  form.append('model', file);
  form.append('scale', '1');
  try {
    const res = await fetch(`/api/assets/${type}`, {
      method: 'POST',
      headers: { 'x-admin-token': token },
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    alert('Asset uploaded');
    await loadAssetsAndConfig();
  } catch (err) {
    console.error('Upload failed', err);
    alert('Upload failed');
  }
}

async function deleteAsset(type, id) {
  const token = tokenInput.value.trim();
  if (!token) {
    alert('Enter admin token');
    return;
  }
  if (!confirm('Delete this asset?')) return;
  try {
    const res = await fetch(`/api/assets/${type}/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': token },
    });
    if (!res.ok) throw new Error('Delete failed');
    await loadAssetsAndConfig();
  } catch (err) {
    console.error('Delete failed', err);
    alert('Delete failed');
  }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number') return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let num = bytes;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return `${num.toFixed(1)} ${units[i]}`;
}

function renderLists(manifest, config) {
  if (bodyList) bodyList.innerHTML = '';
  if (tvList) tvList.innerHTML = '';
  manifest.bodies.forEach((b) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '5px';
    const viewer = document.createElement('model-viewer');
    viewer.src = `/assets/${b.filename}`;
    viewer.style.width = '60px';
    viewer.style.height = '60px';
    const info = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = b.filename;
    const meta = document.createElement('small');
    const sizeText = formatBytes(b.size);
    const uploadedText = b.uploaded ? new Date(b.uploaded).toLocaleString() : 'unknown date';
    meta.textContent = `${sizeText} • ${uploadedText}`;
    info.append(name, document.createElement('br'), meta);
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'bodySelect';
    radio.value = b.id;
    if (config.defaultBodyId === b.id) {
      radio.checked = true;
      selectedBody = b;
    }
    radio.addEventListener('change', () => { selectedBody = b; updatePreview(); });
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteAsset('body', b.id));
    row.append(viewer, info, radio, del);
    bodyList.appendChild(row);
  });
  manifest.tvs.forEach((t) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '5px';
    const viewer = document.createElement('model-viewer');
    viewer.src = `/assets/${t.filename}`;
    viewer.style.width = '60px';
    viewer.style.height = '60px';
    const info = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = t.filename;
    const meta = document.createElement('small');
    const sizeText = formatBytes(t.size);
    const uploadedText = t.uploaded ? new Date(t.uploaded).toLocaleString() : 'unknown date';
    meta.textContent = `${sizeText} • ${uploadedText}`;
    info.append(name, document.createElement('br'), meta);
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'tvSelect';
    radio.value = t.id;
    if (config.defaultTvId === t.id) {
      radio.checked = true;
      selectedTV = t;
      tvScaleRange.value = String(t.scale);
    }
    radio.addEventListener('change', () => { selectedTV = t; tvScaleRange.value = String(t.scale); updatePreview(); });
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteAsset('tv', t.id));
    row.append(viewer, info, radio, del);
    tvList.appendChild(row);
  });
}

async function loadAssetsAndConfig() {
  try {
    const [manifestRes, configRes] = await Promise.all([
      fetch('/api/assets'),
      fetch('/world-config'),
    ]);
    currentManifest = await manifestRes.json();
    const cfg = await configRes.json();
    renderLists(currentManifest, cfg);
    if (cfg.tvPosition) {
      tvPosX.value = String(cfg.tvPosition.x);
      tvPosY.value = String(cfg.tvPosition.y);
      tvPosZ.value = String(cfg.tvPosition.z);
    }
    if (cfg.webcamOffset) {
      camPosX.value = String(cfg.webcamOffset.x);
      camPosY.value = String(cfg.webcamOffset.y);
      camPosZ.value = String(cfg.webcamOffset.z);
      camScaleRange.value = String(cfg.webcamOffset.scale);
    }
    updatePreview();
  } catch (err) {
    console.error('Failed to load assets or config', err);
  }
}
loadAssetsAndConfig();

if (uploadBodyBtn) uploadBodyBtn.addEventListener('click', () => uploadAsset('body'));
if (uploadTVBtn) uploadTVBtn.addEventListener('click', () => uploadAsset('tv'));

[tvPosX, tvPosY, tvPosZ, tvScaleRange].forEach((input) => {
  if (input) {
    input.addEventListener('input', () => {
      if (tvGroup) {
        if (input === tvScaleRange) {
          tvGroup.scale.setScalar(parseFloat(tvScaleRange.value));
        } else {
          tvGroup.position.set(parseFloat(tvPosX.value), parseFloat(tvPosY.value), parseFloat(tvPosZ.value));
        }
      }
    });
  }
});
[camPosX, camPosY, camPosZ, camScaleRange].forEach((input) => {
  if (input) {
    input.addEventListener('input', () => {
      if (camPlane) {
        if (input === camScaleRange) {
          camPlane.scale.setScalar(parseFloat(camScaleRange.value));
        } else {
          camPlane.position.set(parseFloat(camPosX.value), parseFloat(camPosY.value), parseFloat(camPosZ.value));
        }
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
      webcamOffset: {
        x: parseFloat(camPosX.value),
        y: parseFloat(camPosY.value),
        z: parseFloat(camPosZ.value),
        scale: parseFloat(camScaleRange.value),
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
if (savePlacementBtn) savePlacementBtn.addEventListener('click', savePlacement);
