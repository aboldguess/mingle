/**
 * mingle_navbar.js
 * Mini README:
 * - Purpose: handle global navbar interactions including profile dropdown,
 *   sign-out flow and in-page overlays for secondary screens.
 * - Structure:
 *   1. Debug helper for consistent logging across files
 *   2. Dropdown toggle and sign-out behaviour
 *   3. Overlay creation and handlers for menu links
 * - Notes: overlays load existing HTML pages in an iframe to avoid full page
 *   navigations while keeping pages self-contained for direct access.
 */

// ---------------------------------------------------------------------------
// 1. Debug helper
// ---------------------------------------------------------------------------
function navDebugLog(...args) {
  if (window.MINGLE_DEBUG) {
    console.log(...args);
  }
}

// ---------------------------------------------------------------------------
// 2. Profile dropdown and sign-out
// ---------------------------------------------------------------------------
const profileButton = document.getElementById('profileButton');
const dropdown = document.getElementById('profileDropdown');
profileButton.addEventListener('click', () => {
  dropdown.classList.toggle('show');
  navDebugLog('Profile menu toggled');
});

const signOutLink = document.getElementById('signOut');
signOutLink.addEventListener('click', (e) => {
  e.preventDefault();
  navDebugLog('Sign out selected');
  alert('You have been signed out.');
  window.location.href = '/';
});

// ---------------------------------------------------------------------------
// 3. Overlay support for menu links
// ---------------------------------------------------------------------------
// Skip overlay creation when this script is running inside an iframe to avoid
// nested overlays. In that case links behave normally within the frame.
const IN_IFRAME = window.self !== window.top;

if (!IN_IFRAME) {
  // Create a reusable overlay element which loads pages inside an iframe. This
  // keeps navigation within the current session while allowing individual pages
  // to be served directly if required.
  const overlay = document.createElement('div');
  overlay.id = 'navOverlay';
  overlay.className = 'nav-overlay';
  overlay.innerHTML = `
    <div class="nav-overlay-content">
      <button id="overlayCloseBtn" aria-label="Close overlay">✕</button>
      <iframe id="overlayFrame" title="Menu overlay"></iframe>
    </div>`;
  document.body.appendChild(overlay);

  // Inject minimal styling so the overlay is consistently presented without
  // duplicating CSS across pages.
  const style = document.createElement('style');
  style.textContent = `
    .nav-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.7); display: none; z-index: 400;
                    justify-content: center; align-items: center; }
    .nav-overlay.show { display: flex; }
    .nav-overlay-content { position: relative; width: 80%; height: 80%;
                           background: #fff; }
    .nav-overlay-content button { position: absolute; top: 5px; right: 5px;
                                  cursor: pointer; }
    .nav-overlay-content iframe { width: 100%; height: 100%; border: 0; }
  `;
  document.head.appendChild(style);

  const overlayFrame = document.getElementById('overlayFrame');
  const overlayCloseBtn = document.getElementById('overlayCloseBtn');

  function openOverlay(url) {
    overlayFrame.src = url;
    overlay.classList.add('show');
    navDebugLog('Overlay opened for', url);
  }

  function closeOverlay() {
    overlay.classList.remove('show');
    overlayFrame.src = 'about:blank';
    navDebugLog('Overlay closed');
  }

  overlayCloseBtn.addEventListener('click', closeOverlay);

  // Intercept clicks on dropdown links (except the sign-out link) to open the
  // target page inside the overlay. This retains the existing pages but presents
  // them as modals.
  dropdown.querySelectorAll('a').forEach(link => {
    if (link.id === 'signOut') return; // preserve native sign-out behaviour
    link.addEventListener('click', evt => {
      evt.preventDefault();
      dropdown.classList.remove('show');
      openOverlay(link.getAttribute('href'));
    });
  });
} else {
  navDebugLog('Navbar running inside iframe; overlay handlers disabled');
}
