/**
 * world_admin.js
 * Mini README:
 * - Purpose: handle world configuration form interactions for administrators and
 *   manage avatar asset uploads.
 * - Structure:
 *   1. Helper debug logger
 *   2. Load existing config when requested
 *   3. Submit updates back to the server
 *   4. Handle world design (geometry and colour) fields
 *   5. Upload body and TV models with scale and screen-region preview
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
