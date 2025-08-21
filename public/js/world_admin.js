/**
 * world_admin.js
 * Mini README:
 * - Purpose: handle world configuration form interactions for administrators.
 * - Structure:
 *   1. Helper debug logger
 *   2. Load existing config when requested
 *   3. Submit updates back to the server
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
