/**
 * utils.js
 * Mini README:
 * - Purpose: shared helper utilities for client modules, primarily debug logging
 *   that respects the server's debug flag.
 * - Structure:
 *   1. debugLog() - wrapper around console.log
 *   2. debugError() - wrapper around console.error
 * - Notes: Only emits logs when window.MINGLE_DEBUG is truthy so production
 *   builds remain silent.
 */
export function debugLog(...args) {
  if (window.MINGLE_DEBUG) {
    console.log(...args);
  }
}

export function debugError(...args) {
  if (window.MINGLE_DEBUG) {
    console.error(...args);
  }
}
