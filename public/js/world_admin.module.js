/**
 * world_admin.module.js
 * Mini README:
 * - Purpose: handle world configuration form interactions for administrators,
 *   manage avatar asset uploads and placement.
 * - Structure:
 *   1. Helper debug logger
 *   2. Load existing config when requested
 *   3. Submit updates back to the server
 *   4. Handle world design (geometry and colour) fields
 *   5. Upload body and TV models and disable uploads when admin token is missing
 *   6. List uploaded assets with metadata, selection radios and delete controls
 *   7. Three.js preview for aligning TV and webcam canvas before saving
 * - Notes: requires the admin token set on the server. Token is provided via the form.
 *         imports Three.js and GLTFLoader locally from `vendor` to work offline.
 */
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

function adminDebugLog(...args) {
  if (window.MINGLE_DEBUG) {
    console.log(...args);
  }
}
document.addEventListener('DOMContentLoaded', () => {
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
const bodyTableBody = document.getElementById('bodyTableBody');
const tvTableBody = document.getElementById('tvTableBody');
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
  // Initialize Three.js renderer, scene and camera using locally vendored modules.
  renderer = new THREE.WebGLRenderer({ canvas: previewCanvas, alpha: true });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, previewCanvas.width / previewCanvas.height, 0.1, 100);
  camera.position.set(0, 1.5, 3);
  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(light);
  loader = new GLTFLoader();
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}
// Attempt to start the 3D preview, but allow the page to continue even if it fails.
try {
  initThree();
} catch (err) {
  adminDebugLog('Preview initialization failed', err);
  alert('Preview could not start. You can still upload assets.');
}

// Load manifest and config whether or not the preview initializes successfully.
loadAssetsAndConfig();

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
    if (!res.ok) {
      const msg = await res.text();
      adminDebugLog('Upload failed', res.status, msg);
      alert(`Upload failed: ${msg}`);
      return;
    }
    adminDebugLog('Upload succeeded');
    alert('Asset uploaded');
    await loadAssetsAndConfig();
  } catch (err) {
    console.error('Upload failed', err);
    adminDebugLog('Upload encountered error', err);
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
    adminDebugLog('Delete failed', err);
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

/**
 * Render asset manifests into table rows for bodies and TVs.
 * Each row shows a preview, metadata, a radio selector and a delete button.
 */
function renderLists(manifest, config) {
  if (bodyTableBody) bodyTableBody.innerHTML = '';
  if (tvTableBody) tvTableBody.innerHTML = '';
  manifest.bodies.forEach((b) => {
    const row = document.createElement('tr');

    const previewCell = document.createElement('td');
    const viewer = document.createElement('model-viewer');
    viewer.src = `/assets/${b.filename}`;
    viewer.style.width = '60px';
    viewer.style.height = '60px';
    previewCell.appendChild(viewer);

    const infoCell = document.createElement('td');
    const name = document.createElement('span');
    name.textContent = b.filename;
    const meta = document.createElement('small');
    const sizeText = formatBytes(b.size);
    const uploadedText = b.uploaded ? new Date(b.uploaded).toLocaleString() : 'unknown date';
    meta.textContent = `${sizeText} • ${uploadedText}`;
    infoCell.append(name, document.createElement('br'), meta);

    const selectCell = document.createElement('td');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'bodySelect';
    radio.value = b.id;
    if (config.defaultBodyId === b.id) {
      radio.checked = true;
      selectedBody = b;
    }
    radio.addEventListener('change', () => { selectedBody = b; updatePreview(); });
    selectCell.appendChild(radio);

    const deleteCell = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteAsset('body', b.id));
    deleteCell.appendChild(del);

    row.append(previewCell, infoCell, selectCell, deleteCell);
    bodyTableBody.appendChild(row);
  });
  manifest.tvs.forEach((t) => {
    const row = document.createElement('tr');

    const previewCell = document.createElement('td');
    const viewer = document.createElement('model-viewer');
    viewer.src = `/assets/${t.filename}`;
    viewer.style.width = '60px';
    viewer.style.height = '60px';
    previewCell.appendChild(viewer);

    const infoCell = document.createElement('td');
    const name = document.createElement('span');
    name.textContent = t.filename;
    const meta = document.createElement('small');
    const sizeText = formatBytes(t.size);
    const uploadedText = t.uploaded ? new Date(t.uploaded).toLocaleString() : 'unknown date';
    meta.textContent = `${sizeText} • ${uploadedText}`;
    infoCell.append(name, document.createElement('br'), meta);

    const selectCell = document.createElement('td');
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
    selectCell.appendChild(radio);

    const deleteCell = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteAsset('tv', t.id));
    deleteCell.appendChild(del);

    row.append(previewCell, infoCell, selectCell, deleteCell);
    tvTableBody.appendChild(row);
  });
}

/**
 * Fetch asset manifest and world configuration.
 * Also probes the assets endpoint to determine whether admin uploads are
 * available; a 503 response indicates the server lacks an ADMIN_TOKEN and the
 * upload buttons are disabled accordingly.
 */
async function loadAssetsAndConfig() {
  try {
    const manifestRes = await fetch('/api/assets');
    if (manifestRes.status === 503) {
      if (uploadBodyBtn) uploadBodyBtn.disabled = true;
      if (uploadTVBtn) uploadTVBtn.disabled = true;
      adminDebugLog('Admin token not configured; uploads disabled');
      const msg = '<tr><td colspan="4">Asset uploads disabled. Server missing admin token.</td></tr>';
      if (bodyTableBody) bodyTableBody.innerHTML = msg;
      if (tvTableBody) tvTableBody.innerHTML = msg;
      return;
    }
    if (!manifestRes.ok) throw new Error(`Assets request failed: ${manifestRes.status}`);
    if (uploadBodyBtn) uploadBodyBtn.disabled = false;
    if (uploadTVBtn) uploadTVBtn.disabled = false;
    const configRes = await fetch('/world-config');
    if (!configRes.ok) throw new Error(`Config request failed: ${configRes.status}`);
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
    adminDebugLog('Failed to load assets or config', err);
    const msg = '<tr><td colspan="4">Failed to load assets. Check console and server logs.</td></tr>';
    if (bodyTableBody) bodyTableBody.innerHTML = msg;
    if (tvTableBody) tvTableBody.innerHTML = msg;
  }
}

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
});
