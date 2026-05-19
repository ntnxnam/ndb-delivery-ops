import { useState, useCallback, useEffect } from 'react';
import { useJiraData } from './useJiraData';
import { JqlBuilder, jqlTemplates, jqlValidators } from '../services/jqlBuilder';
import { useNotifications } from '../../shared/services/notificationService';
import { JIRA_CONFIG } from '../../shared/utils/constants';

export const useJqlQuery = (initialJql = '', options = {}) => {
  const {
    autoExecute = false,
    maxResults = JIRA_CONFIG.MAX_RESULTS,
    enablePagination = true
  } = options;

  const [jql, setJql] = useState(initialJql);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [validationError, setValidationError] = useState(null);
  
  const { searchByJql, isConnected } = useJiraData();
  const { error: showError } = useNotifications();

  // Calculate pagination values
  const pageSize = enablePagination ? JIRA_CONFIG.DEFAULT_PAGE_SIZE : maxResults;
  const totalPages = Math.ceil(totalResults / pageSize);
  const startAt = (currentPage - 1) * pageSize;

  // Validate JQL query
  const validateJql = useCallback((query) => {
    if (!query || query.trim() === '') {
      setValidationError('JQL query is required');
      return false;
    }

    if (!jqlValidators.isValidJql(query)) {
      setValidationError('Invalid JQL syntax. Please check your query.');
      return false;
    }

    const complexity = jqlValidators.getComplexityScore(query);
    if (complexity > 8) {
      setValidationError('Query is too complex and may be slow. Consider simplifying it.');
      return false;
    }

    if (jqlValidators.isExpensiveJql(query)) {
      setValidationError('Query contains expensive operations that may be slow.');
      // Don't return false - just warn
    }

    setValidationError(null);
    return true;
  }, []);

  // Execute JQL query
  const executeQuery = useCallback(async (page = 1) => {
    if (!isConnected) {
      showError('Not connected to JIRA. Please test your connection first.');
      return;
    }

    if (!validateJql(jql)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const searchStartAt = (page - 1) * pageSize;
      const result = await searchByJql(jql, {
        maxResults: pageSize,
        startAt: searchStartAt
      });

      if (result.success) {
        setResults(result.issues || []);
        setTotalResults(result.total || 0);
        setCurrentPage(page);
      } else {
        throw new Error(result.message || 'Query execution failed');
      }
    } catch (err) {
      console.error('JQL query execution failed:', err);
      setError(err.message);
      showError(err.message);
      setResults(null);
      setTotalResults(0);
    } finally {
      setLoading(false);
    }
  }, [jql, isConnected, pageSize, validateJql, searchByJql, showError]);

  // Update JQL and validate
  const updateJql = useCallback((newJql) => {
    setJql(newJql);
    setCurrentPage(1); // Reset to first page
    validateJql(newJql);
  }, [validateJql]);

  // Use a template
  const useTemplate = useCallback((templateName, ...args) => {
    if (!jqlTemplates[templateName]) {
      showError(`Template "${templateName}" not found`);
      return;
    }

    try {
      const templateJql = jqlTemplates[templateName](...args);
      updateJql(templateJql);
    } catch (err) {
      showError(`Failed to use template: ${err.message}`);
    }
  }, [updateJql, showError]);

  // Build JQL with builder
  const buildJql = useCallback((builderFn) => {
    try {
      const builder = JqlBuilder.create();
      const builtJql = builderFn(builder).build();
      updateJql(builtJql);
      return builtJql;
    } catch (err) {
      showError(`Failed to build JQL: ${err.message}`);
      return null;
    }
  }, [updateJql, showError]);

  // Pagination functions
  const goToPage = useCallback((page) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      executeQuery(page);
    }
  }, [executeQuery, currentPage, totalPages]);

  const nextPage = useCallback(() => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
    }
  }, [currentPage, totalPages, goToPage]);

  const previousPage = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  }, [currentPage, goToPage]);

  // Reset query
  const resetQuery = useCallback(() => {
    setJql('');
    setResults(null);
    setError(null);
    setValidationError(null);
    setCurrentPage(1);
    setTotalResults(0);
  }, []);

  // Auto-execute on mount if enabled
  useEffect(() => {
    if (autoExecute && jql && isConnected) {
      executeQuery(1);
    }
  }, [autoExecute, isConnected]); // Only run when connection status changes

  return {
    // Query state
    jql,
    results,
    loading,
    error,
    validationError,
    
    // Pagination state
    currentPage,
    totalPages,
    totalResults,
    pageSize,
    
    // Query actions
    updateJql,
    executeQuery,
    resetQuery,
    
    // Template helpers
    useTemplate,
    buildJql,
    
    // Pagination actions
    goToPage,
    nextPage,
    previousPage,
    
    // Computed properties
    isValid: !validationError && jql.trim() !== '',
    hasResults: results && results.length > 0,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
    isEmpty: results && results.length === 0,
    
    // Query info
    complexity: jql ? jqlValidators.getComplexityScore(jql) : 0,
    isExpensive: jql ? jqlValidators.isExpensiveJql(jql) : false,
    
    // Pagination info
    startIndex: results ? startAt + 1 : 0,
    endIndex: results ? Math.min(startAt + results.length, totalResults) : 0
  };
};