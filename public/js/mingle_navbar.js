// Navbar logic for Mingle prototype.
// Handles profile menu toggling and sign-out behaviour with optional debug logs.

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
