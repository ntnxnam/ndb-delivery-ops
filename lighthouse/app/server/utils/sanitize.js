const { sanitizeInput } = require('../middleware/validation');

// Recursively sanitize object/array to prevent XSS
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Don't sanitize tokens or passwords - they're already handled separately
        if (key.toLowerCase().includes('token') || 
            key.toLowerCase().includes('password') ||
            key.toLowerCase().includes('secret')) {
          sanitized[key] = obj[key];
        } else {
          sanitized[key] = sanitizeObject(obj[key]);
        }
      }
    }
    return sanitized;
  }
  
  return obj;
}

module.exports = { sanitizeObject };

