/**
 * Maps API/network errors to short, user-facing messages.
 * Use one place per flow so the same situation always shows the same message.
 * Log full error/server response for debugging; show only a non-technical line to the user.
 *
 * @param {Error} err - Caught error (may have err.response, err.code, err.message)
 * @param {object} options - Optional context
 * @param {string} options.context - e.g. 'release-versions' | 'release-items' | 'columns'
 * @param {string} options.fallback - Fallback message if no mapping matches
 * @returns {string} User-facing message
 */
export function getUserFacingMessage(err, options = {}) {
  const { context = '', fallback = 'Something went wrong. Please try again.' } = options;
  const status = err?.response?.status;
  const code = err?.code;
  const message = err?.message || '';

  // Network / abort
  if (code === 'ECONNABORTED' || message.includes('aborted') || message.includes('Aborted')) {
    return 'Connection was interrupted. Please try again.';
  }
  if (code === 'ECONNREFUSED' || message.includes('Network Error')) {
    return 'Cannot connect to server. Please check your connection and try again.';
  }

  // HTTP status mapping (agreed messages)
  if (status === 400) {
    const serverMsg = err?.response?.data?.message || err?.response?.data?.error;
    if (context === 'release-versions') {
      return serverMsg || 'Select a team in the header to load release versions.';
    }
    if (context === 'release-items') {
      return serverMsg || 'Select a version and click Load to load items.';
    }
    return serverMsg || 'Invalid request. Please check your selection and try again.';
  }
  if (status === 401) {
    return 'Authentication failed. Please refresh the page and log in again.';
  }
  if (status === 403) {
    return 'You don’t have permission to view this. Contact your admin if you think this is a mistake.';
  }
  if (status === 429) {
    return 'Too many requests. Please wait 60–90 seconds and try again.';
  }
  if (status === 408 || status === 504) {
    return 'Request timed out. Please try again.';
  }
  if (status >= 500) {
    // Server often wraps axios timeouts as 502 with "timeout of Nms exceeded".
    const serverMsg = err?.response?.data?.error || err?.response?.data?.message || message;
    if (/timeout|timed out|ECONNABORTED/i.test(String(serverMsg))) {
      return 'AI generation timed out. Please try again.';
    }
    return 'Server error. Please try again in a moment.';
  }

  // Prefer server-provided message only if it looks user-friendly (short, no stack)
  const serverMsg = err?.response?.data?.error || err?.response?.data?.message;
  if (serverMsg && typeof serverMsg === 'string' && serverMsg.length < 200 && !serverMsg.includes('\n')) {
    return serverMsg;
  }

  return fallback;
}
