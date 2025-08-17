/**
 * Mingle Navbar Script
 *
 * Purpose: Provides interactive navbar behaviour for Mingle pages.
 *
 * Structure:
 * - Helpers: navDebugLog for conditional console output.
 * - Event bindings: profile menu toggle and dropdown interactions.
 * - Sign-out handling: intercepts sign-out link to confirm and redirect.
 *
 * Notes: Intended for reuse across different pages. Debug logging is enabled
 * when `window.MINGLE_DEBUG` is true.
 */

// Helper debug logger to keep verbose output consistent across scripts.
function navDebugLog(...args) {
  if (window.MINGLE_DEBUG) {
    console.log(...args);
  }
}

// Toggle the profile dropdown when the profile image is clicked.
const profileButton = document.getElementById('profileButton');
const dropdown = document.getElementById('profileDropdown');
profileButton.addEventListener('click', () => {
  dropdown.classList.toggle('show');
  navDebugLog('Profile menu toggled');
});

// Simple sign-out handler. In a real application this would clear session data
// and redirect to a login screen.
const signOutLink = document.getElementById('signOut');
signOutLink.addEventListener('click', (e) => {
  e.preventDefault();
  navDebugLog('Sign out selected');
  alert('You have been signed out.');
  window.location.href = '/';
});
