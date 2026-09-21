import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { createPortal } from 'react-dom';
import { authenticatedPost, authenticatedGet } from '../utils/api';
import { generateTableHTMLForEmail } from '../utils/emailTableGenerator';
import { useJiraConfig } from '../utils/jiraConfig';
import { formatDateWithHistory } from '../utils/dateHistoryDisplay';
import { logUserAction, UserActions } from '../utils/userActionLogger';
import { useTeam } from '../contexts/TeamContext';
import { useReleaseData } from '../contexts/ReleaseDataContext';
import { 
  useReleaseVersions, 
  useColumnConfig, 
  useGanttConfig,
  useAllVersionsConfig, 
  useReleaseItems,
  useCheckpointHistory, 
  useEmailForm,
  useTcmsData
} from '../hooks';
import ReleaseVersionSelector from './ReleaseVersionSelector';
import ReleaseVersionNotes from './ReleaseVersionNotes';
import ReleaseVersionEmailForm from './ReleaseVersionEmailForm';
import ReleaseVersionGantt from './ReleaseVersionGantt';
import ReleaseVersionTableSection, { sortItems } from './ReleaseVersionTableSection';
import ReleaseVersionLegend from './ReleaseVersionLegend';
import ReleaseVersionFilterBar, { applyFilters } from './ReleaseVersionFilterBar';
import { downloadGantt, downloadExcel, downloadHTML, downloadPDF, downloadBoth } from '../utils/downloadUtils';
import { generateReleaseHighlights } from '../utils/generateReleaseHighlights';
import { fetchBreakdownsForKeys } from '../services/taskBreakdownService';
import { useGateTimeline } from '../release/hooks/useGateTimeline';
import { GateChipStrip } from '../design-system';
import ReleaseSummaryPanel from './ReleaseSummaryPanel';
import { TeamSelector } from '../layout/components/TeamSelector';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import './ReleaseVersionTab.css';
import './EmailSender/EmailSender.css';

function ReleaseVersionTab({ releaseVersionsEmailSenders = [] }) {
  const { hasTeamSelected, isTransitioning, selectedTeamId } = useTeam();
  
  // Custom hooks for state management
  const {
    versions,
    activeVersions,
    inactiveVersions,
    selectedVersion,
    loadingVersions,
    showVersionDropdown,
    defaultVersion,
    setDefaultVersion,
    setSelectedVersion,
    refreshVersions,
    handleVersionChange: handleVersionChangeHook,
    error: versionsError,
    setError: setVersionsError
  } = useReleaseVersions();

  const {
    columnsConfig,
    defaultVersion: configDefaultVersion
  } = useColumnConfig();

  const {
    ganttConfig,
    sprintDates
  } = useGanttConfig(selectedVersion);

  const {
    allVersionsConfig
  } = useAllVersionsConfig();

  const { refreshRelease } = useReleaseData();
  const {
    items,
    loadingItems,
    error: itemsError,
    setError: setItemsError,
    fetchItemsForVersion,
    refreshItemsForVersion,
    setItems,
    sectionMetadata,
  } = useReleaseItems();

  const {
    checkpointHistory,
    fetchHistoryForVersion,
    setCheckpointHistory
  } = useCheckpointHistory();

  const {
    tcmsDataMap,
    // fetchCommitTcmsData, // Disabled - was causing timeouts
    // fetchLongTermTcmsData, // Disabled - was causing timeouts  
    resetTcmsData
  } = useTcmsData();

  const {
    sendingEmail,
    setSendingEmail,
    emailSuccess,
    setEmailSuccess,
    lowlights,
    setLowlights,
    highlights,
    setHighlights,
    callToAction,
    setCallToAction,
    emailRecipients,
    setEmailRecipients,
    emailRecipientsError,
    setEmailRecipientsError,
    lowlightsQuillRef,
    highlightsQuillRef,
    callToActionQuillRef,
    quillModules
  } = useEmailForm();

  // JIRA configuration
  const { jiraBaseUrl } = useJiraConfig();

  // Combined error state (from multiple hooks)
  const error = versionsError || itemsError || '';
  const setError = useCallback((err) => {
    if (err) {
      setVersionsError(err);
      setItemsError(err);
    } else {
      setVersionsError('');
      setItemsError('');
    }
  }, [setItemsError, setVersionsError]);

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const { gates: gateTimelineGates, loading: gatesLoading } = useGateTimeline({
    release: selectedVersion,
    jiraToken,
    username,
  });
  const normalizedUsername = (username || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '');
  // REACT_APP_RELEASE_VERSIONS_EMAIL_ACCESS controls who sees the email compose section:
  //   'allowlist' (default) → only releaseVersionsEmailSenders from allowedUsers.json
  //   'all'                 → any authenticated user
  //   'none'                → no one (hides the section entirely)
  const emailAccess = (process.env.REACT_APP_RELEASE_VERSIONS_EMAIL_ACCESS || 'allowlist').toLowerCase().trim();
  const allowedSendersNormalized = (releaseVersionsEmailSenders || []).map(u => (u || '').trim().toLowerCase().replace(/@nutanix\.com$/i, ''));
  const isEmailSectionUser = emailAccess === 'all'
    ? true
    : emailAccess === 'none'
      ? false
      : allowedSendersNormalized.length > 0 && allowedSendersNormalized.includes(normalizedUsername);
  const refreshButtonContainerRef = useRef(null);
  const hasInitialSynced = useRef(false);
  const lastLoadedKeyRef = useRef('');
  const ganttChartRef = useRef(null);
  const pdfContentRef = useRef(null);  // wraps Gantt + tables for PDF capture
  const [downloading, setDownloading] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);

  // Executive Summary functionality moved to ReleaseTrendsPage

  // VooDoo integration state removed - functionality moved to ReleaseTrendsPage

  // Task Breakdown state
  const [breakdownDataMap, setBreakdownDataMap] = useState(new Map());
  const [loadingBreakdowns, setLoadingBreakdowns] = useState(false);

  // Release-level context for AI exec summary enrichment
  const [releaseContext, setReleaseContext] = useState(null);

  // AI Release Briefing state (driven by ReleaseSummaryPanel via toolbar button)
  const [briefingState, setBriefingState] = useState('idle'); // idle | loading | done | error
  const [briefingSummary, setBriefingSummary] = useState(null);
  const [briefingIntelligence, setBriefingIntelligence] = useState(null);
  const [briefingError, setBriefingError] = useState(null);

  // Filter state — client-side, no re-fetch needed
  const [activeFilters, setActiveFilters] = useState({ risk: '', status: '', assignee: '', assigneeManager: '', staleness: '' });
  const [activeSection, setActiveSection] = useState(''); // '' | 'commit' | 'longTermFunded'

  const handleFilterChange = (key, value) => setActiveFilters(prev => ({ ...prev, [key]: value }));

  // Reset filters whenever a new version is loaded
  const resetFilters = () => {
    setActiveFilters({ risk: '', status: '', assignee: '', staleness: '' });
    setActiveSection('');
  };

  // Fetch breakdown data for all visible items
  const fetchBreakdownData = useCallback(async (itemsData, itemType = 'all') => {
    // fetchBreakdownData called - this should only happen when dependencies change
    
    if (!itemsData) {
      // No items data available - only clear if fetching all items
      if (itemType === 'all') {
        setBreakdownDataMap(new Map());
      }
      return;
    }

    let jiraKeys = [];
    
    if (itemType === 'commit' && itemsData.commit?.length) {
      jiraKeys = itemsData.commit.map(item => item.key).filter(Boolean);
    } else if (itemType === 'longTermFunded' && itemsData.longTermFunded?.length) {
      jiraKeys = itemsData.longTermFunded.map(item => item.key).filter(Boolean);
    } else if (itemType === 'all') {
      // Only combine when explicitly requested - for backward compatibility
      jiraKeys = [
        ...(itemsData.commit || []),
        ...(itemsData.longTermFunded || [])
      ].map(item => item.key).filter(Boolean);
    }

    // Extracted JIRA keys for breakdown fetch

    if (jiraKeys.length === 0) {
      // No JIRA keys to process - only clear if fetching all items
      if (itemType === 'all') {
        setBreakdownDataMap(new Map());
      }
      return;
    }

    if (!jiraToken || !username) {
      console.warn('[DEBUG] Missing authentication - jiraToken:', !!jiraToken, 'username:', username);
      return;
    }

    setLoadingBreakdowns(true);
    try {
      // Fetching breakdown data for keys
      const breakdownMap = await fetchBreakdownsForKeys(jiraKeys, jiraToken, username);
      console.log('[DEBUG] Received breakdown map with', breakdownMap.size, 'entries');
      
      // Merge with existing breakdown data instead of replacing it
      setBreakdownDataMap(prevMap => {
        const newMap = new Map(prevMap);
        for (const [key, value] of breakdownMap) {
          newMap.set(key, value);
        }
        console.log('[DEBUG] Merged breakdown map now has', newMap.size, 'total entries');
        return newMap;
      });
    } catch (error) {
      console.error('[DEBUG] Failed to fetch breakdown data:', error);
      // Don't clear existing data on error, just log it
      console.warn('[DEBUG] Keeping existing breakdown data due to fetch error');
    } finally {
      setLoadingBreakdowns(false);
    }
  }, [jiraToken, username]);

  // Merge TCMS QI data onto items whenever tcmsDataMap updates
  const enrichedItems = useMemo(() => {
    if (!tcmsDataMap || Object.keys(tcmsDataMap).length === 0) return items;
    const enrich = (arr) => arr.map(item => {
      const tcms = tcmsDataMap[item.key];
      if (!tcms) return item;
      return { ...item, tcmsQI: tcms.tcmsQI };
    });
    return {
      commit: enrich(items.commit || []),
      longTermFunded: enrich(items.longTermFunded || [])
    };
  }, [items, tcmsDataMap]);

  // Derived: items after applying section + field filters
  const filteredItems = useMemo(() => {
    const commitSrc = activeSection === 'longTermFunded' ? [] : (enrichedItems.commit || []);
    const ltfSrc = activeSection === 'commit' ? [] : (enrichedItems.longTermFunded || []);
    return {
      commit: applyFilters(commitSrc, activeFilters),
      longTermFunded: applyFilters(ltfSrc, activeFilters)
    };
  }, [enrichedItems, activeFilters, activeSection]);

  const totalCount = (items.commit?.length || 0) + (items.longTermFunded?.length || 0);
  const filteredCount = (filteredItems.commit?.length || 0) + (filteredItems.longTermFunded?.length || 0);

  // Coordinate default version from config with release versions hook
  // REQ-RELEASE-008: On component mount, default release version from config is automatically selected
  // REQ-RELEASE-008A: User can still manually change version via dropdown (after initial sync)
  useEffect(() => {
    // Only sync on initial mount when config first loads
    // Don't force it back if user has manually changed it
    if (configDefaultVersion && !hasInitialSynced.current) {
      setSelectedVersion(configDefaultVersion);
      setDefaultVersion(configDefaultVersion);
      hasInitialSynced.current = true;
    }
    // Remove selectedVersion from dependencies to prevent infinite loop
  }, [configDefaultVersion, setSelectedVersion, setDefaultVersion]);

  // Versions are loaded by SelectedReleaseProvider. Do not refetch on an empty
  // list — that retried after every failed load and stormed the versions API.

  // Handle committed items initial loading and background tasks
  useEffect(() => {
    if (items.commit && items.commit.length > 0 && selectedVersion) {
      console.log('[ReleaseVersionTab] Committed items loaded, starting background tasks...');
      
      // Generate highlights/lowlights for committed items
      try {
        const { highlightsHtml, lowlightsHtml, callToActionHtml } = generateReleaseHighlights(
          items,
          selectedVersion,
          jiraBaseUrl
        );
        setHighlights(highlightsHtml);
        setLowlights(lowlightsHtml);
        setCallToAction(callToActionHtml);
      } catch (genErr) {
        console.warn('[generateReleaseHighlights] Failed to generate content for committed items:', genErr.message);
      }

      // TCMS calls disabled - they were causing timeouts and bombing the system
      // const commitKeys = items.commit.map(i => i.key).filter(Boolean);
      // if (commitKeys.length > 0) {
      //   fetchCommitTcmsData(selectedVersion, commitKeys).catch(tcmsErr => 
      //     console.warn('[useEffect] Background TCMS fetch for commit items failed:', tcmsErr.message)
      //   );
      // }

      // Fetch breakdown data for committed items only
      fetchBreakdownData(items, 'commit').catch(breakdownErr => 
        console.warn('[useEffect] Background breakdown fetch for committed items failed:', breakdownErr.message)
      );

      // Fetch release-level context for AI exec summary enrichment (fire-and-forget)
      if (jiraToken && selectedVersion) {
        authenticatedGet('/api/jira/executive-summary-unified', { version: selectedVersion })
          .then(resp => {
            if (resp?.data) setReleaseContext(resp.data);
          })
          .catch(err =>
            console.warn('[useEffect] Background release context fetch failed:', err.message)
          );
      }
    }
  }, [items.commit, selectedVersion, jiraBaseUrl, fetchBreakdownData, items, setHighlights, setLowlights, setCallToAction, jiraToken]);

  // Handle long-term items loading completion
  useEffect(() => {
    if (items.longTermFunded && items.longTermFunded.length > 0 && selectedVersion) {
      console.log('[ReleaseVersionTab] Long-term items loaded, updating background tasks...');
      
      // Update highlights/lowlights with full data (committed + long-term)
      try {
        const { highlightsHtml, lowlightsHtml, callToActionHtml } = generateReleaseHighlights(
          items,
          selectedVersion,
          jiraBaseUrl
        );
        setHighlights(highlightsHtml);
        setLowlights(lowlightsHtml);
        setCallToAction(callToActionHtml);
      } catch (genErr) {
        console.warn('[generateReleaseHighlights] Failed to update content with long-term items:', genErr.message);
      }

      // TCMS calls disabled - they were causing timeouts and bombing the system
      // const longTermKeys = items.longTermFunded.map(i => i.key).filter(Boolean);
      // if (longTermKeys.length > 0) {
      //   fetchLongTermTcmsData(selectedVersion, longTermKeys).catch(tcmsErr => 
      //     console.warn('[useEffect] Background TCMS fetch for long-term items failed:', tcmsErr.message)
      //   );
      // }

      // Fetch breakdown data for long-term items only  
      fetchBreakdownData(items, 'longTermFunded').catch(breakdownErr => 
        console.warn('[useEffect] Background breakdown fetch for long-term items failed:', breakdownErr.message)
      );
    }
  }, [items.longTermFunded, selectedVersion, jiraBaseUrl, fetchBreakdownData, items, setHighlights, setLowlights, setCallToAction]);

  // Find the refresh button container in the header
  useEffect(() => {
    const container = document.getElementById('refresh-versions-button-container');
    if (container) {
      refreshButtonContainerRef.current = container;
    }
  }, []);

  const loadVersionData = useCallback(async (version, { userInitiated = false } = {}) => {
    if (!version) {
      setError('Please select a version');
      return;
    }
    if (!jiraToken) {
      setError('JIRA token required');
      return;
    }

    setError('');
    setVersionsError('');
    setItemsError('');
    resetFilters();
    setItems({ commit: [], longTermFunded: [] });
    setCheckpointHistory({});
    resetTcmsData();
    setBreakdownDataMap(new Map());

    try {
      const itemsResult = await fetchItemsForVersion(version, {
        ignoreFailureCooldown: userInitiated,
      });
      if (itemsResult) {
        try {
          await fetchHistoryForVersion(version);
        } catch (historyError) {
          console.warn('[ReleaseVersionTab] History fetch failed (items still available):', historyError?.message || historyError);
        }
      }
    } catch (error) {
      console.error('[ReleaseVersionTab] Error loading release items:', error);
    }
  }, [fetchHistoryForVersion, fetchItemsForVersion, jiraToken, resetTcmsData, setCheckpointHistory, setError, setItems, setItemsError, setVersionsError]);

  // Load payload when the selected version (or team) changes. Once per
  // team+version — a failed load does not auto-retry (Load / picking again does).
  useEffect(() => {
    if (!selectedVersion || !jiraToken || !hasTeamSelected || isTransitioning) return;
    const key = `${selectedTeamId || ''}::${selectedVersion}`;
    if (lastLoadedKeyRef.current === key) return;
    lastLoadedKeyRef.current = key;
    loadVersionData(selectedVersion, { userInitiated: false });
  }, [hasTeamSelected, isTransitioning, jiraToken, loadVersionData, selectedTeamId, selectedVersion]);

  const handleVersionChange = async (event) => {
    const newVersion = event.target.value;
    lastLoadedKeyRef.current = newVersion
      ? `${selectedTeamId || ''}::${newVersion}`
      : '';
    handleVersionChangeHook(event);
    setItems({ commit: [], longTermFunded: [] });
    setCheckpointHistory({});
    setBreakdownDataMap(new Map());
    setReleaseContext(null);
    setBriefingState('idle');
    setBriefingSummary(null);
    setBriefingIntelligence(null);
    setBriefingError(null);

    await logUserAction(UserActions.VERSION_CHANGED, newVersion, {
      previousVersion: selectedVersion
    });

    if (newVersion) {
      await loadVersionData(newVersion, { userInitiated: true });
    }
  };



  // AI Release Briefing — triggered from the toolbar button
  const handleGenerateBriefing = useCallback(async () => {
    if (!selectedVersion || !jiraToken) return;
    setBriefingState('loading');
    setBriefingError(null);
    try {
      const resp = await authenticatedPost('/api/ai/release-summary', { version: selectedVersion });
      const payload = resp.data || resp;
      setBriefingSummary(payload.summary);
      setBriefingIntelligence(payload.intelligence);
      setBriefingState('done');
    } catch (err) {
      setBriefingError(err.response?.data?.error || err.message || 'Failed to generate release briefing');
      setBriefingState('error');
    }
  }, [selectedVersion, jiraToken]);

  const fetchItems = async () => {
    await logUserAction(UserActions.FETCH_ITEMS_CLICKED, selectedVersion);
    if (selectedVersion) {
      lastLoadedKeyRef.current = `${selectedTeamId || ''}::${selectedVersion}`;
    }
    await loadVersionData(selectedVersion, { userInitiated: true });
  };

  // Helper function to render "Not Set" with consistent highlighting
  const renderNotSet = () => {
    return <span style={{ backgroundColor: '#fff3cd', fontWeight: 600 }}>Not Set</span>;
  };

  // Helper function to check release-level missing dates (CG/PG dates from config)
  const checkReleaseLevelMissingDates = (ganttConfig) => {
    const missingDates = [];
    
    if (!ganttConfig) {
      // If no config, we can't determine if dates are missing
      return missingDates;
    }
    
    // Check if CG dates exist in config
    const hasCGDate = Object.keys(ganttConfig).some(key => {
      if (key.startsWith('commitGate')) {
        const gate = ganttConfig[key];
        if (gate) {
          if (Array.isArray(gate)) {
            return gate.length > 0 && gate.some(g => g && g.date);
          } else if (gate.date) {
            return true;
          }
        }
      }
      return false;
    });
    
    // Check if PG dates exist in config
    const hasPGDate = Object.keys(ganttConfig).some(key => {
      if (key.startsWith('promotionGate')) {
        const gate = ganttConfig[key];
        if (gate) {
          if (Array.isArray(gate)) {
            return gate.length > 0 && gate.some(g => g && g.date);
          } else if (gate.date) {
            return true;
          }
        }
      }
      return false;
    });
    
    if (!hasCGDate) {
      missingDates.push('CG date not provided');
    }
    if (!hasPGDate) {
      missingDates.push('PG date not provided');
    }
    
    return missingDates;
  };

  // Helper function to normalize date to Date object for comparison
  const normalizeDateForComparison = (dateValue) => {
    if (!dateValue) return null;
    
    let date;
    if (typeof dateValue === 'string') {
      // Handle ISO format with time
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
        date = new Date(dateValue);
      } 
      // Handle YYYY-MM-DD format
      else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        // Parse as local date to avoid timezone issues
        const [year, month, day] = dateValue.split('-').map(Number);
        date = new Date(year, month - 1, day);
      } 
      // Handle other string formats (try parsing)
      else {
        date = new Date(dateValue);
      }
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'object' && dateValue !== null) {
      // Handle JIRA date objects that might have a 'value' or 'date' property
      const dateStr = dateValue.value || dateValue.date || dateValue;
      if (typeof dateStr === 'string') {
        date = new Date(dateStr);
      } else {
        return null;
      }
    } else {
      return null;
    }
    
    // Validate the date
    if (isNaN(date.getTime())) {
      return null;
    }
    
    // Return Date object for comparison
    return date;
  };

  // Helper function to check if a date is older than N days
  const _isDateOlderThan = (dateValue, days) => {
    if (!dateValue) return false;
    
    let date;
    if (typeof dateValue === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
        date = new Date(dateValue);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        date = new Date(dateValue + 'T00:00:00');
      } else {
        date = new Date(dateValue);
      }
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else {
      return false;
    }
    
    if (isNaN(date.getTime())) {
      return false;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    
    const diffTime = today - compareDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays > days;
  };

  // Helper function to format dates
  const _formatDate = (dateValue) => {
    if (!dateValue) return renderNotSet();
    
    let date;
    if (typeof dateValue === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateValue)) {
        date = new Date(dateValue);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        date = new Date(dateValue + 'T00:00:00');
      } else {
        date = new Date(dateValue);
      }
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else {
      return renderNotSet();
    }
    
    if (isNaN(date.getTime())) {
      return renderNotSet();
    }
    
    const day = String(date.getDate()).padStart(2, '0'); // Zero-padded: 05 instead of 5
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  };

  // Consolidated helper function to format date with history
  // Displays all historical dates in reverse chronological order (newest to oldest)
  // Helper functions to get column orders from config (client-side)
  const _getUIColumnOrder = () => {
    if (!columnsConfig) return [];
    return (columnsConfig.columnOrder || []).filter(columnKey => {
      const col = columnsConfig.columns?.[columnKey];
      return col && col.includeInUI !== false; // Default to true if not specified
    }).sort((a, b) => {
      const orderA = columnsConfig.columns?.[a]?.order || 999;
      const orderB = columnsConfig.columns?.[b]?.order || 999;
      return orderA - orderB;
    });
  };

  const _getColumnLabel = (columnKey) => {
    if (!columnsConfig) return columnKey;
    return columnsConfig.columns?.[columnKey]?.label || columnKey;
  };

  const _getColumnWidth = (columnKey) => {
    if (!columnsConfig) return '';
    return columnsConfig.columns?.[columnKey]?.width || '';
  };

  // formatDateWithHistory moved to utils/dateHistoryUtils.js

  // Sorting functions moved to ReleaseVersionTableSection component

  // Helper function to get extension label info - simplified to just check if any label ends with suffix
  const getExtensionLabelInfo = (item) => {
    if (!item || !item.labels) {
      return null;
    }
    
    // Handle labels - can be array, comma-separated string, or space-separated
    let labels = [];
    if (Array.isArray(item.labels)) {
      labels = item.labels;
    } else if (typeof item.labels === 'string') {
      // Try comma-separated first, then space-separated
      labels = item.labels.includes(',') 
        ? item.labels.split(',').map(l => l.trim())
        : item.labels.split(/\s+/).map(l => l.trim());
    }
    
    // Check if any label ends with "code-complete-extension-recieved" (case-insensitive)
    // Note: "extension" is the correct spelling (not "extention")
    const extensionSuffix = 'code-complete-extension-recieved';
    
    for (const label of labels) {
      if (!label) continue;
      const labelLower = String(label).toLowerCase().trim();
      if (labelLower.endsWith(extensionSuffix)) {
        return {
          hasExtension: true
        };
      }
    }
    
    return null;
  };
  
  // Helper function to get color for extension - single color for all
  const getExtensionColor = (_dateStr) => {
    // Use a single color for all extension labels - darker orange for better visibility
    return {
      backgroundColor: '#ffcc80', // Darker orange background for better visibility
      borderColor: '#ff9800'     // Orange border
    };
  };

  // Helper function to render all checkpoint dates in a single column
  const _renderAllCheckpointDates = (item, selectedVersion, checkpointHistory) => {
    const dates = [
      { label: 'FS/DS Done Date', field: 'fsdsDone', value: item.customfield_13861 },
      { label: 'Test Plan Date', field: 'testPlan', value: item.customfield_11068 },
      { label: 'Code Complete Date', field: 'codeComplete', value: item.customfield_11067 },
      { label: 'Commit Gate Ready Estimation Date', field: 'commitGate', value: item.customfield_35863 },
      { label: 'Promotion Gate Ready Estimation Date', field: 'promotionGate', value: item.customfield_35864 }
    ];
    
    // Get extension label info (if any)
    const extensionInfo = getExtensionLabelInfo(item, selectedVersion);
    
    // Normalize and compare FS/DS Done Date and Test Plan Date
    const fsdsDate = normalizeDateForComparison(item.customfield_13861);
    const testPlanDate = normalizeDateForComparison(item.customfield_11068);
    
    // Determine highlighting conditions
    let fsdsHighlight = null; // null, 'yellow', or 'red'
    let testPlanHighlight = null;
    
    if (fsdsDate instanceof Date && testPlanDate instanceof Date) {
      // Compare dates by normalizing to YYYY-MM-DD for accurate comparison
      const fsdsYear = fsdsDate.getFullYear();
      const fsdsMonth = fsdsDate.getMonth();
      const fsdsDay = fsdsDate.getDate();
      
      const testPlanYear = testPlanDate.getFullYear();
      const testPlanMonth = testPlanDate.getMonth();
      const testPlanDay = testPlanDate.getDate();
      
      // Check if dates are the same (same year, month, day)
      if (fsdsYear === testPlanYear && fsdsMonth === testPlanMonth && fsdsDay === testPlanDay) {
        // Dates are the same - highlight both with yellow
        fsdsHighlight = 'yellow';
        testPlanHighlight = 'yellow';
      } 
      // Check if FS/DS Done Date is after Test Plan Date
      else if (fsdsDate.getTime() > testPlanDate.getTime()) {
        // FS/DS Done Date is after Test Plan Date - highlight both with red
        fsdsHighlight = 'red';
        testPlanHighlight = 'red';
      }
      // If Test Plan > FS/DS, no highlighting (normal flow)
    }

    return (
      <div style={{ lineHeight: '1.8', fontSize: '11px' }}>
        {dates.map((date, index) => {
          // Determine if this date should be highlighted
          let highlightStyle = null;
          if (date.field === 'fsdsDone' && fsdsHighlight) {
            highlightStyle = fsdsHighlight === 'red' 
              ? { border: '2px solid #de350b', borderRadius: '4px', padding: '4px', backgroundColor: '#ffeaea' }
              : { border: '2px solid #ffc107', borderRadius: '4px', padding: '4px', backgroundColor: '#fffbf0' };
          } else if (date.field === 'testPlan' && testPlanHighlight) {
            highlightStyle = testPlanHighlight === 'red'
              ? { border: '2px solid #de350b', borderRadius: '4px', padding: '4px', backgroundColor: '#ffeaea' }
              : { border: '2px solid #ffc107', borderRadius: '4px', padding: '4px', backgroundColor: '#fffbf0' };
          }
          
          // Add extension label highlighting for Code Complete Date - just background color, no border
          let extensionHighlightStyle = null;
          if (date.field === 'codeComplete' && extensionInfo) {
            const extensionColor = getExtensionColor(); // Single color for all
            extensionHighlightStyle = {
              backgroundColor: extensionColor.backgroundColor
              // No border, no padding, just background color
            };
          }
          
          // For Code Complete with extension, use extension style only
          let finalStyle = {};
          if (date.field === 'codeComplete' && extensionHighlightStyle) {
            finalStyle = {
              backgroundColor: extensionHighlightStyle.backgroundColor,
              marginBottom: index < dates.length - 1 ? '8px' : '0'
            };
          } else {
            // Other dates - merge highlight styles
            finalStyle = {
              marginBottom: index < dates.length - 1 ? '8px' : '0',
              ...(highlightStyle || {}),
              ...(extensionHighlightStyle || {})
            };
          }
          
          return (
            <div 
              key={date.field} 
              style={finalStyle}
            >
              <div style={{ fontWeight: 600, color: '#495057', marginBottom: '2px', fontSize: '10px' }}>
                {date.label}:
              </div>
              <div style={{ paddingLeft: '4px' }}>
                {formatDateWithHistory(item.key, date.field, date.value, checkpointHistory)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Helper function to format link fields
  const _formatLinkField = (fieldValue) => {
    if (!fieldValue) return renderNotSet();
    
    // If it's a URL
    if (typeof fieldValue === 'string' && (fieldValue.startsWith('http://') || fieldValue.startsWith('https://'))) {
      return <a href={fieldValue} target="_blank" rel="noopener noreferrer">Link</a>;
    }
    
    // If it's just text (NA, Not needed, etc.)
    return fieldValue;
  };

  // Helper function to extract executive summary (2 lines) from Status Update
  const extractExecutiveSummary = (statusUpdate) => {
    if (!statusUpdate || typeof statusUpdate !== 'string') return renderNotSet();
    
    // Remove JIRA wiki markup but preserve content
    let text = statusUpdate
      .replace(/\{color:[^}]+\}(.*?)\{color\}/g, '$1') // Extract text from color markup
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold markers but keep text
      .replace(/\[([^\]]+)\|([^\]]+)\]/g, '') // Remove links entirely
      .replace(/\[([^\]]+)\]/g, '') // Remove links without URL entirely
      .trim();
    
    // Split into lines and process
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) return renderNotSet();
    
    // Look for key patterns: dates, milestones, status indicators
    const datePattern = /\d{1,2}\/\w{3}\/\d{4}|\d{1,2}-\w{3}|\d{4}-\d{2}-\d{2}/i;
    const statusPattern = /(Done|In Progress|In progress|TBD|Not Done|Not Started|Completed|Blocked|At Risk)/i;
    const milestonePattern = /(PRD|Requirements|FS\/DS|Test Plan|Coding|Testing|QA|Milestone|Sprint|ETA)/i;
    
    // Extract meaningful sentences (not just first lines)
    const meaningfulLines = [];
    
    // First pass: Look for lines with dates, status, or milestones
    for (const line of lines) {
      if (meaningfulLines.length >= 2) break;
      
      const hasDate = datePattern.test(line);
      const hasStatus = statusPattern.test(line);
      const hasMilestone = milestonePattern.test(line);
      const isLongEnough = line.length > 20; // Skip very short lines
      
      // Prioritize lines with key information
      if ((hasDate || hasStatus || hasMilestone) && isLongEnough) {
        // Clean up the line
        let cleanLine = line
          .replace(/^h[1-6]\.\s+/i, '') // Remove heading markers
          .replace(/^#+\s+/, '') // Remove list markers
          .replace(/^[-*]\s+/, '') // Remove bullet markers
          .trim();
        
        if (cleanLine.length > 10) {
          meaningfulLines.push(cleanLine);
        }
      }
    }
    
    // Second pass: If we didn't find enough key info, take meaningful content
    if (meaningfulLines.length < 2) {
      for (const line of lines) {
        if (meaningfulLines.length >= 2) break;
        
        // Skip if already added
        if (meaningfulLines.includes(line.trim())) continue;
        
        // Skip very short lines, headings, or pure formatting
        const cleanLine = line
          .replace(/^h[1-6]\.\s+/i, '')
          .replace(/^#+\s+/, '')
          .replace(/^[-*]\s+/, '')
          .trim();
        
        // Look for substantial content (not just markers or single words)
        if (cleanLine.length > 30 && !cleanLine.match(/^[A-Z\s]+$/)) {
          meaningfulLines.push(cleanLine);
        }
      }
    }
    
    // If still not enough, take first substantial lines
    if (meaningfulLines.length < 2) {
      for (const line of lines) {
        if (meaningfulLines.length >= 2) break;
        const cleanLine = line
          .replace(/^h[1-6]\.\s+/i, '')
          .replace(/^#+\s+/, '')
          .replace(/^[-*]\s+/, '')
          .trim();
        
        if (cleanLine.length > 15 && !meaningfulLines.includes(cleanLine)) {
          meaningfulLines.push(cleanLine);
        }
      }
    }
    
    // Format the summary: limit each line to ~100 characters for better readability
    const summaryLines = meaningfulLines.slice(0, 2).map(line => {
      // Remove excessive whitespace and clean up
      let cleaned = line
        .replace(/\s+/g, ' ')
        .replace(/\{[^}]+\}/g, '') // Remove any remaining JIRA markup
        .trim();
      
      // Capitalize first letter for better presentation
      if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
      
      if (cleaned.length > 100) {
        // Try to break at a sentence boundary
        const sentenceMatch = cleaned.substring(0, 100).match(/[.!?]/);
        if (sentenceMatch && sentenceMatch.index > 60) {
          return cleaned.substring(0, sentenceMatch.index + 1);
        }
        // Try to break at a word boundary
        const wordMatch = cleaned.substring(0, 97).match(/\s+\S*$/);
        if (wordMatch && wordMatch.index > 60) {
          return cleaned.substring(0, wordMatch.index) + '...';
        }
        return cleaned.substring(0, 97) + '...';
      }
      return cleaned;
    });
    
    if (summaryLines.length === 0) return renderNotSet();
    
    // Get full cleaned text for tooltip (also remove links)
    const fullText = statusUpdate
      .replace(/\{color:[^}]+\}(.*?)\{color\}/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\|([^\]]+)\]/g, '') // Remove links entirely
      .replace(/\[([^\]]+)\]/g, '') // Remove links without URL entirely
      .replace(/\{[^}]+\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Format as two lines with better visual separation
    return (
      <div 
        title={fullText.length > summaryLines.join(' ').length ? fullText : undefined}
        style={{ 
          fontSize: '12px', 
          lineHeight: '1.5',
          color: '#212529',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          cursor: fullText.length > summaryLines.join(' ').length ? 'help' : 'default'
        }}
      >
        {summaryLines.map((line, idx) => (
          <div 
            key={idx} 
            style={{ 
              marginBottom: idx < summaryLines.length - 1 ? '6px' : '0',
              paddingBottom: idx < summaryLines.length - 1 ? '4px' : '0',
              borderBottom: idx < summaryLines.length - 1 ? '1px solid #e9ecef' : 'none'
            }}
          >
            {line}
          </div>
        ))}
      </div>
    );
  };

  // Helper function to format JIRA wiki markup (complete version with nested lists support)
  const formatJiraWikiMarkup = (text) => {
    if (!text || typeof text !== 'string') return '';
    
    // First, escape HTML to prevent XSS
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Process line by line for block-level elements
    const lines = formatted.split('\n');
    const processedLines = [];
    let listStack = []; // Stack to track nested lists: [{type: 'ordered'|'unordered', level: number}, ...]
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // JIRA headings: h1., h2., h3., etc.
      if (/^h[1-6]\.\s+(.+)$/i.test(trimmed)) {
        // Close all open lists
        while (listStack.length > 0) {
          const list = listStack.pop();
          processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
        }
        const match = trimmed.match(/^h([1-6])\.\s+(.+)$/i);
        const level = parseInt(match[1]);
        const headingText = match[2];
        processedLines.push(`<h${level} style="font-size: ${24 - (level - 1) * 2}px; font-weight: 600; margin: 15px 0 8px 0; color: #1a1a1a;">${headingText}</h${level}>`);
        continue;
      }
      
      // Numbered list items: #, ##, ###, etc. (nested ordered lists)
      const orderedListMatch = trimmed.match(/^(#+)\s+(.+)$/);
      if (orderedListMatch) {
        const hashCount = orderedListMatch[1].length;
        const itemText = orderedListMatch[2];
        const targetLevel = hashCount;
        
        // Close lists that are deeper than current level (use > instead of >=)
        while (listStack.length > 0 && listStack[listStack.length - 1].level > targetLevel) {
          const list = listStack.pop();
          processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
        }
        
        // Open nested lists if needed
        while (listStack.length < targetLevel) {
          const currentLevel = listStack.length + 1;
          processedLines.push(`<ol style="margin: 6px 0; padding-left: ${20 + (currentLevel - 1) * 20}px;">`);
          listStack.push({ type: 'ordered', level: currentLevel });
        }
        
        processedLines.push(`<li style="margin: 4px 0;">${itemText}</li>`);
        continue;
      }
      
      // Bullet list items: * item or - item
      if (/^[-*]\s+(.+)$/.test(trimmed)) {
        // Close ordered lists if switching to unordered
        while (listStack.length > 0 && listStack[listStack.length - 1].type === 'ordered') {
          listStack.pop();
          processedLines.push('</ol>');
        }
        
        // Open unordered list if not already open
        if (listStack.length === 0 || listStack[listStack.length - 1].type !== 'unordered') {
          processedLines.push('<ul style="margin: 8px 0; padding-left: 25px; list-style-type: disc;">');
          listStack.push({ type: 'unordered', level: 1 });
        }
        
        const itemText = trimmed.replace(/^[-*]\s+/, '');
        processedLines.push(`<li style="margin: 4px 0;">${itemText}</li>`);
        continue;
      }
      
      // Empty line - close all lists
      if (trimmed === '') {
        while (listStack.length > 0) {
          const list = listStack.pop();
          processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
        }
        processedLines.push('<br>');
        continue;
      }
      
      // Regular line - close all lists if not a continuation
      if (listStack.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
        while (listStack.length > 0) {
          const list = listStack.pop();
          processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
        }
      }
      
      processedLines.push(`<div style="margin-bottom: 6px;">${trimmed}</div>`);
    }
    
    // Close any remaining open lists
    while (listStack.length > 0) {
      const list = listStack.pop();
      processedLines.push(list.type === 'ordered' ? '</ol>' : '</ul>');
    }
    
    formatted = processedLines.join('');
    
    // Process inline formatting
    // JIRA color markup: {color:#hex}text{color} or {color:red}text{color}
    // Use non-greedy matching to handle multiple color blocks and nested content
    formatted = formatted.replace(/\{color:([^}]+)\}(.*?)\{color\}/g, (match, color, content) => {
      const colorMap = {
        'red': '#de350b',
        'green': '#00875a',
        'yellow': '#ff8b00',
        'blue': '#0052cc',
        'orange': '#ff8b00'
      };
      // Trim color value and handle hex codes with or without #
      const colorValue = color.trim();
      let finalColor;
      if (colorMap[colorValue.toLowerCase()]) {
        finalColor = colorMap[colorValue.toLowerCase()];
      } else if (colorValue.startsWith('#')) {
        finalColor = colorValue;
      } else {
        // Assume it's a hex code without #
        finalColor = '#' + colorValue;
      }
      return `<span style="color: ${finalColor};">${content}</span>`;
    });
    
    // {*}bold{*} syntax (must be before bare *bold* to avoid partial matches)
    formatted = formatted.replace(/\{\*\}(.*?)\{\*\}/gs, '<strong>$1</strong>');
    // {-}strikethrough{-}
    formatted = formatted.replace(/\{-\}(.*?)\{-\}/gs, '<del style="text-decoration: line-through; color: #999;">$1</del>');
    // {+}underline{+}
    formatted = formatted.replace(/\{\+\}(.*?)\{\+\}/gs, '<u>$1</u>');
    // {_}italic{_}
    formatted = formatted.replace(/\{_\}(.*?)\{_\}/gs, '<em>$1</em>');

    // **bold** and *bold*
    formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(?<!\*)\*([^*\n<]+)\*(?!\*)/g, '<strong>$1</strong>');

    // -strikethrough- (dash form, avoid list bullets and compound words)
    formatted = formatted.replace(/(?<!\w)-([^\-\n]{2,}?)-(?!\w)/g, '<del style="text-decoration: line-through; color: #999;">$1</del>');
    // _italic_ (underscore form)
    formatted = formatted.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<em>$1</em>');

    // JIRA links
    formatted = formatted.replace(/\[([^\]]+)\|([^\]]+)\]/g, '<a href="$2" style="color: #0065ff; text-decoration: none;">$1</a>');
    formatted = formatted.replace(/\[([^\]]+)\]/g, '<a href="#" style="color: #0065ff; text-decoration: none;">$1</a>');
    
    // JIRA issue keys
    formatted = formatted.replace(/([A-Z]+-\d+)/g, `<a href="${jiraBaseUrl}/browse/$1" style="color: #0065ff; text-decoration: none;">$1</a>`);
    
    return formatted;
  };

  // Unified download handler for the Download split button in the toolbar
  const handleDownload = async (type) => {
    if (downloading) return;

    setDownloading(true);
    setError('');
    try {
      const opts = { filteredItems, checkpointHistory, version: selectedVersion, jiraBaseUrl };
      if (type === 'gantt') {
        await downloadGantt(ganttChartRef, selectedVersion);
      } else if (type === 'excel') {
        downloadExcel(opts);
      } else if (type === 'html') {
        downloadHTML(opts);
      } else if (type === 'pdf') {
        await downloadPDF(pdfContentRef, selectedVersion);
      } else if (type === 'both') {
        await downloadBoth({ ganttRef: ganttChartRef, ...opts });
      }
    } catch (err) {
      console.error('Download error:', err);
      setError('Download failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  // Calculate risk counts from filtered items
  // Risk counts calculation removed - functionality moved to ReleaseTrendsPage

  // Executive Summary analytics moved to backend unified endpoint

  // Config dates and P0 bug logic moved to backend unified endpoint

  // Executive Summary generation moved to ReleaseTrendsPage

  // VooDoo AI Integration Functions moved to ReleaseTrendsPage
  // All VooDoo-related functions have been moved to ReleaseTrendsPage component

  // Note: Removed automatic API key check on component mount to prevent unnecessary API calls
  // The API key will be checked when user actually tries to generate AI summary

  const handleSendEmail = async (previewOnly = false) => {
    if (!previewOnly) {
      await logUserAction(UserActions.EMAIL_SEND_CLICKED, selectedVersion, {
        hasHighlights: !!highlights,
        hasLowlights: !!lowlights,
        hasCallToAction: !!callToAction,
        recipientsCount: emailRecipients ? emailRecipients.split(/[,;]/).filter(r => r.trim()).length : 0
      });
    }
    if (!username) {
      if (!previewOnly) setError('User email is required to send email');
      if (previewOnly) throw new Error('User email is required');
      return;
    }

    if ((items.commit?.length || 0) === 0 && (items.longTermFunded?.length || 0) === 0) {
      if (!previewOnly) setError('No items to send in email');
      if (previewOnly) throw new Error('No items to send in email');
      return;
    }

    if (!previewOnly) {
      setSendingEmail(true);
      setError('');
      setEmailSuccess(false);
    }

    try {
      // Validate email recipients if provided
      if (emailRecipients && emailRecipients.trim()) {
        const recipients = emailRecipients.split(',').map(r => r.trim()).filter(r => r);
        const usernameRegex = /^[a-z0-9._-]+$/i;
        const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
        
        for (let i = 0; i < recipients.length; i++) {
          const recipient = recipients[i];
          const isValid = recipient.includes('@') ? emailRegex.test(recipient) : usernameRegex.test(recipient);
          if (!isValid) {
            setError(`Invalid recipient format at position ${i + 1}: "${recipient}". Please enter a valid Nutanix email (e.g., user@nutanix.com) or username (e.g., user.name).`);
            setSendingEmail(false);
            return;
          }
        }
      }
      
      // Use client-side column config (already loaded on mount)
      if (!columnsConfig) {
        setError('Column configuration not loaded. Please refresh the page.');
        setSendingEmail(false);
        return;
      }
      
      const _uiColumnOrder = columnsConfig?.columnOrder?.filter(key => {
        const col = columnsConfig?.columns?.[key];
        return col && col.includeInUI !== false;
      }) || [];
      const _emailColumnOrder = columnsConfig?.columnOrder?.filter(key => {
        const col = columnsConfig?.columns?.[key];
        return col && col.includeInEmail !== false;
      }) || [];
      // Generate HTML table on frontend (hybrid approach)
      const tableHTML = generateTableHTMLForEmail(
        items,
        checkpointHistory,
        selectedVersion,
        columnsConfig,
        formatJiraWikiMarkup,
        extractExecutiveSummary,
        getExtensionLabelInfo,
        getExtensionColor,
        jiraBaseUrl,
        sectionMetadata // Pass section metadata for dynamic section handling
      );
      
      // Capture Gantt chart as image if available
      let ganttChartImageData = null;
      if (ganttChartRef.current && ganttConfig) {
        try {
          const canvas = await html2canvas(ganttChartRef.current, {
            backgroundColor: '#f0f0f0',
            scale: 2, // Higher quality
            logging: false,
            useCORS: true,
            allowTaint: false
          });
          // Convert canvas to base64 data URL
          ganttChartImageData = canvas.toDataURL('image/png');
        } catch (error) {
          console.error('Error capturing Gantt chart:', error);
          // Continue without Gantt chart image if capture fails
        }
      }
      
      const payload = {
        selectedVersion,
        tableHTML,
        lowlights,
        highlights,
        callToAction,
        emailRecipients: emailRecipients || '',
        ganttConfig,
        items: enrichedItems.commit || [],
        ganttChartImageData
      };

      if (previewOnly) {
        const { ganttChartImageData: _omitted, ...previewPayload } = payload;
        const previewResponse = await authenticatedPost('/api/email/send-release-versions', { ...previewPayload, previewOnly: true }, { jiraToken, username });
        return previewResponse.data;
      }

      const response = await authenticatedPost('/api/email/send-release-versions', payload, {
        jiraToken,
        username
      });

      if (response.data.success) {
        setEmailSuccess(true);
        setTimeout(() => setEmailSuccess(false), 5000); // Hide success message after 5 seconds
      } else {
        setError(response.data.error || 'Failed to send email');
      }
    } catch (err) {
      console.error('Error sending email:', err);
      if (!previewOnly) setError(err.response?.data?.error || err.message || 'Failed to send email');
      if (previewOnly) throw err;
    } finally {
      if (!previewOnly) setSendingEmail(false);
    }
  };

  const handleRefreshNow = useCallback(async () => {
    setRefreshingLive(true);
    setError('');
    try {
      if (typeof refreshVersions === 'function') {
        await refreshVersions();
      }
      if (selectedVersion) {
        await refreshItemsForVersion(selectedVersion);
      }
      if (typeof refreshRelease === 'function') {
        await refreshRelease();
      }
    } catch (err) {
      setError(err?.message || 'Failed to refresh live data');
    } finally {
      setRefreshingLive(false);
    }
  }, [refreshItemsForVersion, refreshRelease, refreshVersions, selectedVersion, setError]);

  // Row rendering moved to ReleaseVersionTableRow component


  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        selectorId="project-status-team-select"
        description="Project Status shows payload tracking, Gantt charts, and email generation for the selected team's base query."
      />
    );
  }

  // Show loading state during team transitions
  if (isTransitioning) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ backgroundColor: '#e7f3ff', padding: '2rem', borderRadius: '8px', maxWidth: '400px', margin: '0 auto' }}>
          <h3 style={{ color: '#0c5460', margin: '0 0 1rem 0' }}>Switching Teams</h3>
          <p style={{ color: '#0c5460', margin: 0 }}>
            ⏳ Please wait while we load data for the selected team...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="release-version-tab" style={{ padding: '0.5rem', width: '100%', minWidth: '100%', maxWidth: '100%', margin: 0, boxSizing: 'border-box', overflow: 'visible' }}>
      
      {/* CSS for spinner animation */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>

      {/* Render Refresh Versions button in header via portal */}
      {refreshButtonContainerRef.current && createPortal(
        <button
          onClick={async () => {
            // Clear errors before fetching
            setError('');
            setVersionsError('');
            setItemsError('');
            await logUserAction(UserActions.FETCH_VERSIONS_CLICKED, 'release-versions');
            refreshVersions();
          }}
          disabled={loadingVersions || !jiraToken}
          style={{
            padding: '0.4rem 0.8rem',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '0',
            cursor: loadingVersions || !jiraToken ? 'not-allowed' : 'pointer',
            opacity: loadingVersions || !jiraToken ? 0.6 : 1,
            fontSize: '0.85rem'
          }}
        >
          {loadingVersions ? 'Loading...' : 'Refresh Versions'}
        </button>,
        refreshButtonContainerRef.current
      )}

      {error && (
        <div style={{
          marginBottom: '0.75rem',
          padding: '0.5rem',
          borderRadius: '0',
          backgroundColor: '#f5f5f5',
          color: '#721c24',
          fontSize: '0.85rem',
          borderLeft: '3px solid #c33'
        }}>
          <span style={{ display: 'block', marginBottom: '0.5rem' }}>{error}</span>
          
          <button
            type="button"
            onClick={() => {
              setVersionsError('');
              setItemsError('');
              refreshVersions();
              if (selectedVersion) fetchItems();
            }}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
              backgroundColor: '#721c24',
              color: 'white',
              border: 'none',
              borderRadius: '2px'
            }}
          >
            Try again
          </button>
        </div>
      )}

      <div style={{ backgroundColor: '#f8f9fa', padding: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: '#495057' }}>
            Live JIRA for this team's base filter
          </span>
          <button
            onClick={handleRefreshNow}
            disabled={refreshingLive || loadingItems || loadingVersions}
            style={{
              padding: '0.3rem 0.7rem',
              backgroundColor: '#495057',
              color: 'white',
              border: 'none',
              cursor: refreshingLive || loadingItems || loadingVersions ? 'not-allowed' : 'pointer',
              opacity: refreshingLive || loadingItems || loadingVersions ? 0.6 : 1,
              fontSize: '0.8rem'
            }}
          >
            {refreshingLive ? 'Refreshing live…' : 'Refresh Now'}
          </button>
        </div>
        <ReleaseVersionSelector
          activeVersions={activeVersions}
          inactiveVersions={inactiveVersions}
          versions={versions}
          selectedVersion={selectedVersion}
          defaultVersion={defaultVersion}
          showVersionDropdown={showVersionDropdown}
          loadingVersions={loadingVersions}
          loadingItems={loadingItems}
          jiraToken={jiraToken}
          onVersionChange={handleVersionChange}
          onFetchItems={fetchItems}
          hasData={totalCount > 0}
          hasGanttChart={!!ganttConfig}
          downloading={downloading}
          onDownload={handleDownload}
          onGenerateBriefing={handleGenerateBriefing}
          briefingState={briefingState}
          teamSelector={<TeamSelector variant="page" id="project-status-team-select" />}
        />
      </div>
      
      {/* Rich Text Notes Section and Email — visible when user is allowed to send (allowlist or gating disabled) */}
      {isEmailSectionUser && !loadingItems && selectedVersion && ((items.commit?.length || 0) > 0 || (items.longTermFunded?.length || 0) > 0) && (
        <>
          <ReleaseVersionNotes
            highlights={highlights}
            lowlights={lowlights}
            callToAction={callToAction}
            setHighlights={setHighlights}
            setLowlights={setLowlights}
            setCallToAction={setCallToAction}
            highlightsQuillRef={highlightsQuillRef}
            lowlightsQuillRef={lowlightsQuillRef}
            callToActionQuillRef={callToActionQuillRef}
            quillModules={quillModules}
          />
          
          <ReleaseVersionEmailForm
            emailRecipients={emailRecipients}
            emailRecipientsError={emailRecipientsError}
            sendingEmail={sendingEmail}
            emailSuccess={emailSuccess}
            username={username}
            setEmailRecipients={setEmailRecipients}
            setEmailRecipientsError={setEmailRecipientsError}
            onSendEmail={() => handleSendEmail(false)}
            getPreview={async () => handleSendEmail(true)}
          />
        </>
      )}

      {loadingItems && (
        <div style={{ backgroundColor: '#f8f9fa', padding: '0.75rem', marginBottom: '0.75rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            Loading committed items... 
            {sectionMetadata.loadingLongTerm === false && items.commit?.length > 0 && (
              <span style={{ marginLeft: '10px', color: '#28a745' }}>
                ✓ Committed items loaded ({items.commit.length} items)
              </span>
            )}
          </p>
          {sectionMetadata.loadingLongTerm && (
            <p style={{ margin: '5px 0 0 0', fontSize: '0.85rem', color: '#6c757d' }}>
              Loading long-term funded items...
            </p>
          )}
        </div>
      )}

      {/* Show message when version is selected but no items loaded yet */}
      {!loadingItems && selectedVersion && (items.commit?.length || 0) === 0 && (items.longTermFunded?.length || 0) === 0 && (
        <div style={{ padding: '0.75rem', textAlign: 'center', color: '#6c757d', backgroundColor: '#f8f9fa', fontSize: '0.85rem' }}>
          <p style={{ margin: 0 }}>Select a release version to load data, or click &quot;Load&quot; to refresh.</p>
        </div>
      )}

      {/* Long-term loading indicator when committed items are already displayed */}
      {!loadingItems && sectionMetadata.loadingLongTerm && items.commit?.length > 0 && (
        <div style={{ backgroundColor: '#e7f3ff', padding: '0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem', borderLeft: '4px solid #007bff' }}>
          Loading long-term funded items in background... ({items.commit.length} committed items already displayed)
        </div>
      )}


      {/* Show tables when items are loaded */}
      {!loadingItems && selectedVersion && ((items.commit?.length || 0) > 0 || (items.longTermFunded?.length || 0) > 0) && (
        <div ref={pdfContentRef} style={{ marginBottom: '0.75rem', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>

          {/* AI Release Briefing — visible from loading onward */}
          {briefingState !== 'idle' && (
            <ReleaseSummaryPanel
              state={briefingState}
              summary={briefingSummary}
              intelligence={briefingIntelligence}
              error={briefingError}
            />
          )}

          {/* Filter bar — always shown once data is loaded */}
          <ReleaseVersionFilterBar
            items={items}
            activeFilters={activeFilters}
            onFilterChange={handleFilterChange}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            totalCount={totalCount}
            filteredCount={filteredCount}
          />

          {/* Gantt Chart — uses filtered items so chart reflects active filters */}
          {selectedVersion && (gateTimelineGates.length > 0 || gatesLoading) && (
            <div className="ds-scope" style={{ marginBottom: '0.5rem' }}>
              <GateChipStrip gates={gateTimelineGates} />
            </div>
          )}

          {ganttConfig && (
            <div ref={ganttChartRef}>
              <ReleaseVersionGantt
                ganttConfig={ganttConfig}
                selectedVersion={selectedVersion}
                items={filteredItems}
                checkpointHistory={checkpointHistory}
                sortItems={sortItems}
                sprintDates={sprintDates}
                allVersionsConfig={allVersionsConfig}
                statusesWithTick={columnsConfig?.statusesWithTick || []}
              />
            </div>
          )}

          {/* Legend Section */}
          <ReleaseVersionLegend columnsConfig={columnsConfig} />


          {/* Release-level notice for missing gate dates */}
          {(() => {
            const releaseLevelMissingDates = checkReleaseLevelMissingDates(ganttConfig);
            return releaseLevelMissingDates.length > 0 ? (
              <div style={{
                padding: '0.75rem',
                marginBottom: '1rem',
                backgroundColor: '#fff3cd',
                borderLeft: '4px solid #ffc107',
                fontSize: '0.875rem',
                color: '#856404'
              }}>
                <strong>Release-Level Notice:</strong> {releaseLevelMissingDates.join(', ')}. This applies to all items in this release.
              </div>
            ) : null;
          })()}

          {/* Section 1: Commit */}
          {activeSection !== 'longTermFunded' && (
            <ReleaseVersionTableSection
              title={`Section 1: Commit${activeSection === 'commit' && filteredCount < totalCount ? ` (${filteredItems.commit.length} of ${items.commit?.length || 0})` : ''}`}
              description="Items with fixVersion matching selected version(s)"
              items={filteredItems.commit || []}
              columnsConfig={columnsConfig}
              selectedVersion={selectedVersion}
              checkpointHistory={checkpointHistory}
              jiraBaseUrl={jiraBaseUrl}
              ganttConfig={ganttConfig}
              breakdownDataMap={breakdownDataMap}
              loadingBreakdowns={loadingBreakdowns}
              releaseContext={releaseContext}
            />
          )}

          {/* Section 2: Long-term-funded */}
          {activeSection !== 'commit' && (
            <ReleaseVersionTableSection
              title={`Section 2: Long-term-funded${activeSection === 'longTermFunded' && filteredCount < totalCount ? ` (${filteredItems.longTermFunded.length} of ${items.longTermFunded?.length || 0})` : ''}`}
              description={`Items with label matching "${selectedVersion.toLowerCase()}-long-term-funded"`}
              items={filteredItems.longTermFunded || []}
              columnsConfig={columnsConfig}
              selectedVersion={selectedVersion}
              checkpointHistory={checkpointHistory}
              jiraBaseUrl={jiraBaseUrl}
              ganttConfig={ganttConfig}
              breakdownDataMap={breakdownDataMap}
              loadingBreakdowns={loadingBreakdowns}
              releaseContext={releaseContext}
            />
          )}

          {selectedVersion && (
            <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
              <Link to={`/release-trends?version=${encodeURIComponent(selectedVersion)}`}>
                View release trends
              </Link>
            </p>
          )}
        </div>
      )}

      {/* Executive Summary modal removed - functionality moved to ReleaseTrendsPage */}
    </div>
  );
}

export default ReleaseVersionTab;

