import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authService } from '../services/authService';

export const LoginForm = ({ onSuccess, className = "" }) => {
  const { login, loading, error } = useAuth();
  const [formData, setFormData] = useState({
    jiraToken: ''
  });
  const [validationErrors, setValidationErrors] = useState({});
  const [isValidating, setIsValidating] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear validation error when user starts typing
    if (validationErrors[name]) {
      setValidationErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.jiraToken.trim()) {
      errors.jiraToken = 'JIRA token is required';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsValidating(true);
    
    try {
      // Login with just the JIRA token - server will extract user info
      await login(null, formData.jiraToken);
      
      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Login failed:', err);
      setValidationErrors({
        submit: err.message || 'Login failed. Please check your JIRA token.'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const isSubmitting = loading || isValidating;

  return (
    <form onSubmit={handleSubmit} className={`login-form ${className}`}>
      <div className="form-group">
        <label htmlFor="jiraToken">
          JIRA API Token:
        </label>
        <input
          type="password"
          id="jiraToken"
          name="jiraToken"
          value={formData.jiraToken}
          onChange={handleInputChange}
          placeholder="Enter your JIRA API token"
          disabled={isSubmitting}
          className={validationErrors.jiraToken ? 'error' : ''}
          autoFocus
        />
        {validationErrors.jiraToken && (
          <div className="error-message">{validationErrors.jiraToken}</div>
        )}
        <small className="help-text">
          Generate a JIRA API token from your Atlassian account settings.
          <br />
          <em>Your user information will be automatically detected from the token.</em>
          <br />
          <em>Your credentials will be saved for future sessions.</em>
        </small>
      </div>

      {(error || validationErrors.submit) && (
        <div className="error-message">
          {error || validationErrors.submit}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="login-button"
      >
        {isSubmitting ? 'Authenticating...' : 'Login with JIRA Token'}
      </button>
    </form>
  );
};