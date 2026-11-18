const { body, validationResult } = require('express-validator');

// Username validation
const validateUsername = () => {
  return body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 1, max: 100 }).withMessage('Username must be between 1 and 100 characters')
    .matches(/^[a-z0-9._-]+$/i).withMessage('Username contains invalid characters')
    .customSanitizer((value) => {
      // Normalize: remove @nutanix.com if present, convert to lowercase
      if (value && value.includes('@')) {
        return value.split('@')[0].toLowerCase().trim();
      }
      return value.toLowerCase().trim();
    });
};

// Token validation
const validateToken = (fieldName = 'token') => {
  return body(fieldName)
    .trim()
    .notEmpty().withMessage(`${fieldName} is required`)
    .isLength({ min: 10, max: 500 }).withMessage(`${fieldName} must be between 10 and 500 characters`)
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage(`${fieldName} contains invalid characters`);
};

// JIRA key validation
const validateJiraKey = () => {
  return body('jiraKey')
    .optional()
    .trim()
    .matches(/^[A-Z]+-\d+$/).withMessage('Invalid JIRA key format (e.g., FEAT-123)');
};

// Email validation
const validateEmail = (fieldName = 'email') => {
  return body(fieldName)
    .optional()
    .trim()
    .isEmail().withMessage(`Invalid ${fieldName} format`)
    .normalizeEmail();
};

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// Sanitize input to prevent XSS
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

module.exports = {
  validateUsername,
  validateToken,
  validateJiraKey,
  validateEmail,
  handleValidationErrors,
  sanitizeInput
};

