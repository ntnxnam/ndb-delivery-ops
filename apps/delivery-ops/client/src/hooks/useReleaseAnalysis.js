import { useState, useCallback, useMemo } from 'react';
import { authenticatedPost } from '../utils/api';
import { useNotifications } from '../shared/services/notificationService';

// Milestone dates for reference (from user requirements)
const MILESTONE_DATES = {
  'NDB-2.8': {
    EC: '2024-11-07',
    'Code Complete': '2024-11-26', 
    CG: '2025-01-15',
    'Branch Cut': '2025-02-10', // Estimated between CG and PG
    PG: '2025-02-18',
    GA: '2025-03-24'
  },
  'NDB-2.9': {
    EC: '2025-04-17',
    'Code Complete': '2025-06-05',
    CG: '2025-06-03', // Note: CG before Code Complete in user data
    'Branch Cut': '2025-07-06', // Estimated between CG and PG
    PG: '2025-08-08',
    GA: '2025-10-01'
  },
  'NDB-2.10': {
    EC: '2025-05-08',
    'Code Complete': '2025-09-05',
    CG: '2025-12-03',
    'Branch Cut': '2026-01-18', // Estimated between CG and PG
    PG: '2026-03-02',
    GA: '2026-03-03'
  },
  'NDB-2.11': {
    EC: '2025-12-09',
    'Code Complete': '2026-02-27',
    CG: '2026-04-14',
    'Branch Cut': '2026-04-28', // Estimated between CG and PG
    PG: '2026-05-12',
    GA: '2026-06-15'
  }
};

// April 22, 2026 is the fixed boundary date from user requirements
const FIXED_BOUNDARY_DATE = new Date('2026-04-22');
const THREE_WEEKS_MS = 3 * 7 * 24 * 60 * 60 * 1000; // 21 days in milliseconds

/**
 * Generate 3-week bins with April 22, 2026 as a boundary
 */
const generateThreeWeekBins = (startDate, endDate) => {
  const bins = [];
  const fixedBoundary = FIXED_BOUNDARY_DATE.getTime();
  
  // Generate bins going backward from the fixed boundary
  let currentEnd = fixedBoundary;
  while (currentEnd > startDate.getTime()) {
    const binStart = new Date(currentEnd - THREE_WEEKS_MS);
    const binEnd = new Date(currentEnd - 1); // End of previous bin
    
    if (binEnd.getTime() >= startDate.getTime()) {
      bins.unshift({
        start: binStart,
        end: new Date(currentEnd),
        label: `${binStart.toISOString().split('T')[0]} to ${new Date(currentEnd).toISOString().split('T')[0]}`
      });
    }
    
    currentEnd = binStart.getTime();
  }
  
  // Generate bins going forward from the fixed boundary
  let currentStart = fixedBoundary;
  while (currentStart < endDate.getTime()) {
    const binEnd = new Date(currentStart + THREE_WEEKS_MS);
    
    if (currentStart < endDate.getTime()) {
      bins.push({
        start: new Date(currentStart),
        end: binEnd,
        label: `${new Date(currentStart).toISOString().split('T')[0]} to ${binEnd.toISOString().split('T')[0]}`
      });
    }
    
    currentStart = binEnd.getTime();
  }
  
  return bins.sort((a, b) => a.start.getTime() - b.start.getTime());
};

/**
 * Categorize issue types according to user requirements
 */
const categorizeIssueType = (issueType) => {
  const type = issueType?.toLowerCase() || '';
  
  if (type.includes('bug')) return 'Bug';
  if (type.includes('improvement') || type.includes('enhancement')) return 'Improvement';
  if (type.includes('test')) return 'Test';
  
  // Everything else except Feature, Initiative, and Epic goes to "Other"
  if (type.includes('feature') || type.includes('initiative') || type.includes('epic')) {
    return 'Other'; // These are usually parent level items, not work items
  }
  
  return 'Other';
};

/**
 * Custom hook for release analysis data management
 */
export const useReleaseAnalysis = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState({
    stage: '',
    message: '',
    progress: 0,
    details: []
  });
  const [progressiveData, setProgressiveData] = useState({
    completedReleases: [],
    partialData: {
      totalTickets: 0,
      releaseMapping: {},
      tickets: []
    }
  });
  const { error: showError } = useNotifications();

  /**
   * Fetch analysis data progressively (one release at a time) to avoid timeouts
   */
  const fetchAnalysisData = useCallback(async (releases = ['NDB-2.8', 'NDB-2.9', 'NDB-2.10', 'NDB-2.11']) => {
    setLoading(true);
    setError(null);
    
    // Initialize progress tracking and progressive data
    setLoadingProgress({
      stage: 'initializing',
      message: 'Preparing to fetch release data...',
      progress: 0,
      details: [`Analyzing ${releases.length} releases: ${releases.join(', ')}`]
    });
    
    // Initialize progressive data state
    setProgressiveData({
      completedReleases: [],
      partialData: {
        totalTickets: 0,
        releaseMapping: {},
        tickets: []
      }
    });

    try {
      console.log('Fetching release analysis data progressively for:', releases);
      
      let allData = {
        success: true,
        totalTickets: 0,
        releases,
        releaseMapping: {},
        tickets: []
      };

      // Fetch releases one by one to avoid timeout
      for (let i = 0; i < releases.length; i++) {
        const release = releases[i];
        const progressPercent = Math.round((i / releases.length) * 70) + 10; // 10-80% for fetching
        
        setLoadingProgress(prev => ({
          ...prev,
          stage: 'fetching',
          message: `Fetching ${release} tickets... (${i + 1}/${releases.length})`,
          progress: progressPercent,
          details: [
            ...prev.details,
            `🔄 Processing ${release}...`
          ]
        }));

        try {
          // Add retry logic for individual releases
          let retries = 2;
          let response;
          
          while (retries >= 0) {
            try {
              response = await authenticatedPost('/api/jira/release-analysis', {
                releases: [release], // Fetch one release at a time
                includeFields: [
                  'key', 'issuetype', 'status', 'resolved', 'resolutiondate',
                  'statusCategoryChangeDate', 'customfield_11067' // Code Complete field
                ]
              });
              break; // Success, exit retry loop
            } catch (retryError) {
              retries--;
              if (retries < 0) {
                throw retryError; // Final failure
              }
              
              console.warn(`Retry ${2 - retries} for ${release}:`, retryError.message);
              setLoadingProgress(prev => ({
                ...prev,
                details: [
                  ...prev.details.slice(0, -1),
                  `🔄 ${release}: Retrying (${2 - retries}/2)...`
                ]
              }));
              
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
            }
          }

          console.log(`Data received for ${release}:`, response.totalTickets, 'tickets');
          
          // Merge data and update progressive state
          if (response.success) {
            const releaseTickets = response.totalTickets || 0;
            allData.totalTickets += releaseTickets;
            allData.tickets = allData.tickets.concat(response.tickets || []);
            Object.assign(allData.releaseMapping, response.releaseMapping || {});
            
            // Update progressive data for immediate chart rendering
            setProgressiveData(prev => ({
              completedReleases: [...prev.completedReleases, release],
              partialData: {
                totalTickets: allData.totalTickets,
                releaseMapping: { ...allData.releaseMapping },
                tickets: [...allData.tickets]
              }
            }));
            
            setLoadingProgress(prev => ({
              ...prev,
              details: [
                ...prev.details.slice(0, -1), // Remove last processing line
                `✓ ${release}: ${releaseTickets} tickets fetched`
              ]
            }));
          }
          
        } catch (releaseError) {
          console.error(`Error fetching ${release}:`, releaseError);
          setLoadingProgress(prev => ({
            ...prev,
            details: [
              ...prev.details.slice(0, -1), // Remove last processing line
              `⚠️ ${release}: Failed to fetch (${releaseError.message || 'timeout'})`
            ]
          }));
          // Continue with other releases
        }
      }
      
      console.log('Combined analysis data:', allData);
      
      // Update progress - data processing
      setLoadingProgress(prev => ({
        ...prev,
        stage: 'processing',
        message: `Processing ${allData.totalTickets} tickets...`,
        progress: 85,
        details: [
          ...prev.details,
          'Categorizing issues and generating 3-week bins',
          'Calculating velocity metrics'
        ]
      }));
      
      setData(allData);
      
      // Final progress update
      setLoadingProgress(prev => ({
        ...prev,
        stage: 'complete',
        message: 'Analysis complete!',
        progress: 100,
        details: [
          ...prev.details,
          '✓ Data processing completed',
          '✓ Charts and visualizations ready'
        ]
      }));
      
    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to fetch release analysis data';
      console.error('Error fetching release analysis data:', err);
      
      // Provide more helpful error messages for common issues
      let userMessage = errorMessage;
      if (err.code === 'ECONNABORTED' || errorMessage.includes('timeout')) {
        userMessage = 'Request timed out. The JIRA server may be slow or the dataset is too large. Try selecting fewer releases or try again later.';
      } else if (err.response?.status === 401) {
        userMessage = 'Authentication failed. Please check your JIRA token and permissions.';
      } else if (err.response?.status >= 500) {
        userMessage = 'Server error occurred. Please try again in a few minutes.';
      }
      
      setError(userMessage);
      // Show error notification without depending on showError in useCallback
      console.error('Release Analysis Error:', userMessage);
      
      // Update progress with error
      setLoadingProgress(prev => ({
        ...prev,
        stage: 'error',
        message: 'Failed to fetch data',
        progress: 0,
        details: [
          ...prev.details,
          `❌ Error: ${userMessage}`
        ]
      }));
    } finally {
      setLoading(false);
    }
  }, []); // Remove showError dependency to prevent infinite loops

  /**
   * Process raw data into analysis format (for final complete data)
   */
  const processedData = useMemo(() => {
    if (!data?.tickets) return [];

    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    
    // Find the overall date range for bin generation
    const resolvedDates = tickets
      .filter(ticket => ticket.resolved || ticket.resolutiondate)
      .map(ticket => new Date(ticket.resolved || ticket.resolutiondate))
      .sort((a, b) => a.getTime() - b.getTime());

    if (resolvedDates.length === 0) return [];

    const earliestDate = resolvedDates[0];
    const latestDate = resolvedDates[resolvedDates.length - 1];
    
    // Generate 3-week bins
    const bins = generateThreeWeekBins(earliestDate, latestDate);

    // Process each ticket
    const processedTickets = tickets
      .filter(ticket => {
        // Filter for tickets with StatusCategory = Done
        if (ticket.statusCategory !== 'Done') return false;
        
        // Must have a resolved date
        const resolvedDate = ticket.resolved || ticket.resolutiondate;
        if (!resolvedDate) return false;

        // Must be resolved after Code Complete date for their release
        const release = data.releaseMapping?.[ticket.key];
        if (!release || !MILESTONE_DATES[release]) return false;

        const codeCompleteDate = new Date(MILESTONE_DATES[release]['Code Complete']);
        const ticketResolvedDate = new Date(resolvedDate);
        
        return ticketResolvedDate > codeCompleteDate;
      })
      .map(ticket => {
        const resolvedDate = new Date(ticket.resolved || ticket.resolutiondate);
        const release = data.releaseMapping?.[ticket.key];
        
        // Find which bin this ticket falls into
        const bin = bins.find(b => 
          resolvedDate.getTime() >= b.start.getTime() && 
          resolvedDate.getTime() <= b.end.getTime()
        );
        
        return {
          issueKey: ticket.key,
          issueType: ticket.issuetype?.name || 'Unknown',
          status: ticket.status?.name || 'Unknown',
          statusCategory: ticket.statusCategory,
          resolvedDate: resolvedDate.toISOString().split('T')[0],
          release,
          issueTypeCategory: categorizeIssueType(ticket.issuetype?.name),
          weekBin: bin?.label || 'Unassigned',
          binStartDate: bin?.start.toISOString().split('T')[0] || null,
          binEndDate: bin?.end.toISOString().split('T')[0] || null
        };
      });

    console.log('Processed analysis data:', processedTickets);
    return processedTickets;
  }, [data]);

  /**
   * Progressive processed data that updates as each release completes
   */
  const progressiveProcessedData = useMemo(() => {
    if (!progressiveData?.partialData?.tickets) return [];

    const tickets = Array.isArray(progressiveData.partialData.tickets) ? progressiveData.partialData.tickets : [];
    
    // Use same processing logic as above but on progressive data
    const resolvedDates = tickets
      .filter(ticket => ticket.resolved || ticket.resolutiondate)
      .map(ticket => new Date(ticket.resolved || ticket.resolutiondate))
      .sort((a, b) => a.getTime() - b.getTime());

    if (resolvedDates.length === 0) return [];

    const earliestDate = resolvedDates[0];
    const latestDate = resolvedDates[resolvedDates.length - 1];
    
    const bins = generateThreeWeekBins(earliestDate, latestDate);

    const processedTickets = tickets
      .filter(ticket => {
        if (ticket.statusCategory !== 'Done') return false;
        
        const resolvedDate = ticket.resolved || ticket.resolutiondate;
        if (!resolvedDate) return false;

        const release = progressiveData.partialData.releaseMapping?.[ticket.key];
        if (!release || !MILESTONE_DATES[release]) return false;

        const codeCompleteDate = new Date(MILESTONE_DATES[release]['Code Complete']);
        const ticketResolvedDate = new Date(resolvedDate);
        
        return ticketResolvedDate > codeCompleteDate;
      })
      .map(ticket => {
        const resolvedDate = new Date(ticket.resolved || ticket.resolutiondate);
        const release = progressiveData.partialData.releaseMapping?.[ticket.key];
        
        const bin = bins.find(b => 
          resolvedDate.getTime() >= b.start.getTime() && 
          resolvedDate.getTime() <= b.end.getTime()
        );
        
        return {
          issueKey: ticket.key,
          issueType: ticket.issuetype?.name || 'Unknown',
          status: ticket.status?.name || 'Unknown',
          statusCategory: ticket.statusCategory,
          resolvedDate: resolvedDate.toISOString().split('T')[0],
          release,
          issueTypeCategory: categorizeIssueType(ticket.issuetype?.name),
          weekBin: bin?.label || 'Unassigned',
          binStartDate: bin?.start.toISOString().split('T')[0] || null,
          binEndDate: bin?.end.toISOString().split('T')[0] || null
        };
      });

    return processedTickets;
  }, [progressiveData]);

  /**
   * Prepare milestone data for charts
   */
  const milestoneData = useMemo(() => {
    const milestones = [];
    
    Object.entries(MILESTONE_DATES).forEach(([release, dates]) => {
      Object.entries(dates).forEach(([milestone, dateStr]) => {
        milestones.push({
          release,
          milestone,
          date: new Date(dateStr),
          dateString: dateStr,
          color: getMilestoneColor(milestone)
        });
      });
    });
    
    return milestones.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, []);

  /**
   * Group velocity data by release
   */
  const velocityByRelease = useMemo(() => {
    if (!processedData.length) return null;

    const groupedByBin = {};
    
    processedData.forEach(ticket => {
      if (!ticket.weekBin || ticket.weekBin === 'Unassigned') return;
      
      if (!groupedByBin[ticket.weekBin]) {
        groupedByBin[ticket.weekBin] = {
          binLabel: ticket.weekBin,
          binStartDate: ticket.binStartDate,
          totalTickets: 0,
          releases: {}
        };
      }
      
      groupedByBin[ticket.weekBin].totalTickets++;
      
      if (!groupedByBin[ticket.weekBin].releases[ticket.release]) {
        groupedByBin[ticket.weekBin].releases[ticket.release] = 0;
      }
      groupedByBin[ticket.weekBin].releases[ticket.release]++;
    });

    const sortedBins = Object.values(groupedByBin).sort((a, b) => 
      new Date(a.binStartDate).getTime() - new Date(b.binStartDate).getTime()
    );

    return {
      bins: sortedBins,
      releases: [...new Set(processedData.map(t => t.release))].filter(Boolean)
    };
  }, [processedData]);

  /**
   * Group velocity data by issue type
   */
  const velocityByIssueType = useMemo(() => {
    if (!processedData.length) return null;

    const groupedByBin = {};
    
    processedData.forEach(ticket => {
      if (!ticket.weekBin || ticket.weekBin === 'Unassigned') return;
      
      if (!groupedByBin[ticket.weekBin]) {
        groupedByBin[ticket.weekBin] = {
          binLabel: ticket.weekBin,
          binStartDate: ticket.binStartDate,
          totalTickets: 0,
          categories: {}
        };
      }
      
      groupedByBin[ticket.weekBin].totalTickets++;
      
      if (!groupedByBin[ticket.weekBin].categories[ticket.issueTypeCategory]) {
        groupedByBin[ticket.weekBin].categories[ticket.issueTypeCategory] = 0;
      }
      groupedByBin[ticket.weekBin].categories[ticket.issueTypeCategory]++;
    });

    const sortedBins = Object.values(groupedByBin).sort((a, b) => 
      new Date(a.binStartDate).getTime() - new Date(b.binStartDate).getTime()
    );

    return {
      bins: sortedBins,
      categories: ['Bug', 'Improvement', 'Test', 'Other']
    };
  }, [processedData]);

  /**
   * Progressive velocity by release (updates as each release completes)
   */
  const progressiveVelocityByRelease = useMemo(() => {
    if (!progressiveProcessedData.length) return null;

    const groupedByBin = {};
    
    progressiveProcessedData.forEach(ticket => {
      if (!ticket.weekBin || ticket.weekBin === 'Unassigned') return;
      
      if (!groupedByBin[ticket.weekBin]) {
        groupedByBin[ticket.weekBin] = {
          binLabel: ticket.weekBin,
          binStartDate: ticket.binStartDate,
          totalTickets: 0,
          releases: {}
        };
      }
      
      groupedByBin[ticket.weekBin].totalTickets++;
      
      if (!groupedByBin[ticket.weekBin].releases[ticket.release]) {
        groupedByBin[ticket.weekBin].releases[ticket.release] = 0;
      }
      groupedByBin[ticket.weekBin].releases[ticket.release]++;
    });

    const sortedBins = Object.values(groupedByBin).sort((a, b) => 
      new Date(a.binStartDate).getTime() - new Date(b.binStartDate).getTime()
    );

    return {
      bins: sortedBins,
      releases: [...new Set(progressiveProcessedData.map(t => t.release))].filter(Boolean),
      completedReleases: progressiveData.completedReleases // Track which releases are complete
    };
  }, [progressiveProcessedData, progressiveData.completedReleases]);

  /**
   * Progressive velocity by issue type (updates as each release completes)
   */
  const progressiveVelocityByIssueType = useMemo(() => {
    if (!progressiveProcessedData.length) return null;

    const groupedByBin = {};
    
    progressiveProcessedData.forEach(ticket => {
      if (!ticket.weekBin || ticket.weekBin === 'Unassigned') return;
      
      if (!groupedByBin[ticket.weekBin]) {
        groupedByBin[ticket.weekBin] = {
          binLabel: ticket.weekBin,
          binStartDate: ticket.binStartDate,
          totalTickets: 0,
          categories: {}
        };
      }
      
      groupedByBin[ticket.weekBin].totalTickets++;
      
      if (!groupedByBin[ticket.weekBin].categories[ticket.issueTypeCategory]) {
        groupedByBin[ticket.weekBin].categories[ticket.issueTypeCategory] = 0;
      }
      groupedByBin[ticket.weekBin].categories[ticket.issueTypeCategory]++;
    });

    const sortedBins = Object.values(groupedByBin).sort((a, b) => 
      new Date(a.binStartDate).getTime() - new Date(b.binStartDate).getTime()
    );

    return {
      bins: sortedBins,
      categories: ['Bug', 'Improvement', 'Test', 'Other']
    };
  }, [progressiveProcessedData]);

  return {
    data,
    loading,
    error,
    loadingProgress,
    progressiveData,
    fetchAnalysisData,
    processedData,
    milestoneData,
    velocityByRelease,
    velocityByIssueType,
    // Progressive versions that update as each release completes
    progressiveProcessedData,
    progressiveVelocityByRelease,
    progressiveVelocityByIssueType
  };
};

/**
 * Get consistent color for milestone types
 */
const getMilestoneColor = (milestone) => {
  const colors = {
    'EC': '#007bff',           // Blue
    'Code Complete': '#fd7e14', // Orange
    'CG': '#6f42c1',          // Purple
    'Branch Cut': '#dc3545',   // Red
    'PG': '#28a745',          // Green
    'GA': '#343a40'           // Black/Dark Grey
  };
  return colors[milestone] || '#6c757d'; // Grey fallback
};