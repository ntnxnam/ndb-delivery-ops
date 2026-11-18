import { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * JIRA configuration utility
 * Provides JIRA base URL for constructing links
 */

// Cache for JIRA base URL (loaded once)
let jiraBaseUrlCache = null;
let jiraBaseUrlPromise = null;

/**
 * Fetches JIRA base URL from backend config
 * @returns {Promise<string>} JIRA base URL
 */
export const fetchJiraBaseUrl = async () => {
  // Return cached value if available
  if (jiraBaseUrlCache) {
    return jiraBaseUrlCache;
  }

  // Return existing promise if already fetching
  if (jiraBaseUrlPromise) {
    return jiraBaseUrlPromise;
  }

  // Fetch from backend
  jiraBaseUrlPromise = axios.get('/api/config/jira')
    .then(response => {
      const baseUrl = response.data?.baseUrl || 'https://jira.nutanix.com';
      // Normalize: remove trailing slash
      jiraBaseUrlCache = baseUrl.replace(/\/+$/, '');
      return jiraBaseUrlCache;
    })
    .catch(error => {
      console.error('Error fetching JIRA config:', error);
      // Fallback to default
      jiraBaseUrlCache = 'https://jira.nutanix.com';
      return jiraBaseUrlCache;
    })
    .finally(() => {
      jiraBaseUrlPromise = null;
    });

  return jiraBaseUrlPromise;
};

/**
 * Gets JIRA issue browse URL
 * @param {string} issueKey - JIRA issue key (e.g., 'FEAT-123')
 * @returns {Promise<string>} Full URL to browse the issue
 */
export const getJiraIssueUrl = async (issueKey) => {
  const baseUrl = await fetchJiraBaseUrl();
  return `${baseUrl}/browse/${issueKey}`;
};

/**
 * Gets JIRA profile URL for PAT tokens
 * @returns {Promise<string>} Full URL to JIRA profile PAT page
 */
export const getJiraProfilePatUrl = async () => {
  const baseUrl = await fetchJiraBaseUrl();
  return `${baseUrl}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens`;
};

/**
 * React hook for JIRA base URL
 * @returns {object} - { jiraBaseUrl, loading }
 */
export function useJiraConfig() {
  const [jiraBaseUrl, setJiraBaseUrl] = useState('https://jira.nutanix.com'); // Default fallback
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadJiraConfig = async () => {
      try {
        const baseUrl = await fetchJiraBaseUrl();
        setJiraBaseUrl(baseUrl);
      } catch (error) {
        console.error('Error loading JIRA config:', error);
        // Keep default fallback
      } finally {
        setLoading(false);
      }
    };

    loadJiraConfig();
  }, []);

  return { jiraBaseUrl, loading };
}

