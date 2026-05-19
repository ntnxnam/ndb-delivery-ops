// Form validation utilities

export const validators = {
  // Required field validation
  required: (value, message = 'This field is required') => {
    if (value === null || value === undefined || String(value).trim() === '') {
      return message;
    }
    return null;
  },

  // Email validation
  email: (value, message = 'Please enter a valid email address') => {
    if (!value) return null; // Allow empty if not required
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return message;
    }
    return null;
  },

  // Nutanix email validation
  nutanixEmail: (value, message = 'Please enter a valid Nutanix email address') => {
    if (!value) return null;
    const nutanixEmailRegex = /^[^\s@]+@nutanix\.com$/i;
    if (!nutanixEmailRegex.test(value)) {
      return message;
    }
    return null;
  },

  // Minimum length validation
  minLength: (minLen) => (value, message = `Minimum ${minLen} characters required`) => {
    if (!value) return null;
    if (String(value).length < minLen) {
      return message;
    }
    return null;
  },

  // Maximum length validation
  maxLength: (maxLen) => (value, message = `Maximum ${maxLen} characters allowed`) => {
    if (!value) return null;
    if (String(value).length > maxLen) {
      return message;
    }
    return null;
  },

  // URL validation
  url: (value, message = 'Please enter a valid URL') => {
    if (!value) return null;
    try {
      new URL(value);
      return null;
    } catch {
      return message;
    }
  },

  // Confluence URL validation
  confluenceUrl: (value, message = 'Please enter a valid Confluence URL') => {
    if (!value) return null;
    
    const confluencePatterns = [
      /^https?:\/\/confluence\.eng\.nutanix\.com:8443\/pages\/(viewpage|viewinfo)\.action\?pageId=\d+/,
      /^https?:\/\/confluence\.eng\.nutanix\.com:8443\/spaces\/\w+\/pages\/\d+/,
      /^\/pages\/(viewpage|viewinfo)\.action\?pageId=\d+/,
      /^\/spaces\/\w+\/pages\/\d+/
    ];
    
    const isValid = confluencePatterns.some(pattern => pattern.test(value));
    if (!isValid) {
      return message;
    }
    return null;
  },

  // JIRA token validation (basic format check)
  jiraToken: (value, message = 'Please enter a valid JIRA API token') => {
    if (!value) return null;
    // Basic token format validation (24+ alphanumeric characters)
    if (!/^[A-Za-z0-9]{20,}$/.test(value)) {
      return message;
    }
    return null;
  },

  // JQL validation (basic syntax check)
  jql: (value, message = 'Please enter valid JQL syntax') => {
    if (!value) return null;
    
    // Basic JQL validation - check for common patterns
    const hasValidOperator = /\s+(=|!=|~|!~|>|>=|<|<=|IN|NOT IN|IS|IS NOT|WAS|WAS IN|WAS NOT|CHANGED)\s+/i.test(value);
    const hasValidField = /\b(project|key|summary|status|assignee|reporter|created|updated|component|fixVersion|labels)\b/i.test(value);
    
    if (!hasValidOperator && !hasValidField) {
      return message;
    }
    return null;
  }
};

// Composite validator that runs multiple validations
export const validate = (value, validationRules = []) => {
  for (const rule of validationRules) {
    const error = rule(value);
    if (error) {
      return error;
    }
  }
  return null;
};

// Validate entire form object
export const validateForm = (formData, validationSchema) => {
  const errors = {};
  let hasErrors = false;

  Object.keys(validationSchema).forEach(fieldName => {
    const fieldRules = validationSchema[fieldName];
    const fieldValue = formData[fieldName];
    
    const error = validate(fieldValue, fieldRules);
    if (error) {
      errors[fieldName] = error;
      hasErrors = true;
    }
  });

  return {
    isValid: !hasErrors,
    errors
  };
};

// Common validation schemas
export const validationSchemas = {
  login: {
    email: [validators.required, validators.email],
    jiraToken: [validators.required, validators.jiraToken]
  },
  
  confluenceExtraction: {
    confluenceUrl: [validators.required, validators.confluenceUrl]
  },
  
  jiraQuery: {
    jql: [validators.required, validators.jql]
  },
  
  email: {
    subject: [validators.maxLength(200)],
    recipients: [validators.required],
    executiveSummary: [validators.required, validators.minLength(10)]
  }
};