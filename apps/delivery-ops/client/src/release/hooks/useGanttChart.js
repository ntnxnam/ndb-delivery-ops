import { useState, useCallback, useEffect, useMemo } from 'react';
import { formatters } from '../../shared/utils/formatters';

export const useGanttChart = (items = [], options = {}) => {
  const {
    dateFields = ['startDate', 'endDate'],
    colorScheme = 'status',
    groupBy = null,
    sortBy = 'startDate'
  } = options;

  const [ganttConfig, setGanttConfig] = useState({
    showGrid: true,
    showToday: true,
    showWeekends: true,
    timeScale: 'days', // days, weeks, months
    zoom: 1,
    dateRange: null // auto-calculate if null
  });

  const [selectedItems, setSelectedItems] = useState(new Set());
  const [filters, setFilters] = useState({
    status: [],
    assignee: [],
    priority: [],
    dateRange: null
  });

  // Calculate date range from items
  const calculatedDateRange = useMemo(() => {
    if (!items || items.length === 0) return null;

    let minDate = null;
    let maxDate = null;

    items.forEach(item => {
      dateFields.forEach(field => {
        const date = item[field];
        if (date) {
          const parsedDate = new Date(date);
          if (!isNaN(parsedDate)) {
            if (!minDate || parsedDate < minDate) {
              minDate = parsedDate;
            }
            if (!maxDate || parsedDate > maxDate) {
              maxDate = parsedDate;
            }
          }
        }
      });
    });

    if (minDate && maxDate) {
      // Add some padding
      const padding = (maxDate - minDate) * 0.1; // 10% padding
      return {
        start: new Date(minDate.getTime() - padding),
        end: new Date(maxDate.getTime() + padding)
      };
    }

    return null;
  }, [items, dateFields]);

  // Get effective date range
  const effectiveDateRange = ganttConfig.dateRange || calculatedDateRange;

  // Process items for Gantt display
  const processedItems = useMemo(() => {
    if (!items || items.length === 0) return [];

    return items.map(item => {
      const processedItem = {
        ...item,
        gantt: {
          startDate: item[dateFields[0]] ? new Date(item[dateFields[0]]) : null,
          endDate: item[dateFields[1]] ? new Date(item[dateFields[1]]) : null,
          duration: 0,
          color: getItemColor(item, colorScheme),
          position: null // Will be calculated during rendering
        }
      };

      // Calculate duration
      if (processedItem.gantt.startDate && processedItem.gantt.endDate) {
        processedItem.gantt.duration = Math.ceil(
          (processedItem.gantt.endDate - processedItem.gantt.startDate) / (1000 * 60 * 60 * 24)
        );
      }

      return processedItem;
    }).filter(item => item.gantt.startDate); // Only include items with start dates
  }, [items, dateFields, colorScheme]);

  // Group items if needed
  const groupedItems = useMemo(() => {
    if (!groupBy) return { 'All Items': processedItems };

    const groups = {};
    processedItems.forEach(item => {
      const groupKey = item[groupBy] || 'Unassigned';
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(item);
    });

    // Sort items within each group
    Object.keys(groups).forEach(groupKey => {
      groups[groupKey].sort((a, b) => {
        if (sortBy && a[sortBy] && b[sortBy]) {
          if (sortBy.includes('Date')) {
            return new Date(a[sortBy]) - new Date(b[sortBy]);
          }
          return a[sortBy].localeCompare(b[sortBy]);
        }
        return 0;
      });
    });

    return groups;
  }, [processedItems, groupBy, sortBy]);

  // Apply filters
  const filteredGroups = useMemo(() => {
    const filtered = {};

    Object.entries(groupedItems).forEach(([groupKey, groupItems]) => {
      const filteredItems = groupItems.filter(item => {
        // Status filter
        if (filters.status.length > 0 && !filters.status.includes(item.status)) {
          return false;
        }

        // Assignee filter
        if (filters.assignee.length > 0 && !filters.assignee.includes(item.assignee)) {
          return false;
        }

        // Priority filter
        if (filters.priority.length > 0 && !filters.priority.includes(item.priority)) {
          return false;
        }

        // Date range filter
        if (filters.dateRange) {
          const itemStart = item.gantt.startDate;
          const itemEnd = item.gantt.endDate || itemStart;
          
          if (itemStart < filters.dateRange.start || itemEnd > filters.dateRange.end) {
            return false;
          }
        }

        return true;
      });

      if (filteredItems.length > 0) {
        filtered[groupKey] = filteredItems;
      }
    });

    return filtered;
  }, [groupedItems, filters]);

  // Get item color based on color scheme
  const getItemColor = useCallback((item, scheme) => {
    switch (scheme) {
      case 'status':
        return getStatusColor(item.status);
      case 'priority':
        return getPriorityColor(item.priority);
      case 'assignee':
        return getAssigneeColor(item.assignee);
      default:
        return '#007bff';
    }
  }, []);

  // Color mapping functions
  const getStatusColor = (status) => {
    const statusColors = {
      'To Do': '#6c757d',
      'In Progress': '#007bff',
      'In Review': '#ffc107',
      'Done': '#28a745',
      'Blocked': '#dc3545',
      'On Hold': '#fd7e14'
    };
    return statusColors[status] || '#6c757d';
  };

  const getPriorityColor = (priority) => {
    const priorityColors = {
      'Highest': '#dc3545',
      'High': '#fd7e14',
      'Medium': '#ffc107',
      'Low': '#28a745',
      'Lowest': '#6c757d'
    };
    return priorityColors[priority] || '#6c757d';
  };

  const getAssigneeColor = (assignee) => {
    // Generate consistent color based on assignee name
    if (!assignee) return '#6c757d';
    
    let hash = 0;
    for (let i = 0; i < assignee.length; i++) {
      hash = assignee.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 50%)`;
  };

  // Update Gantt configuration
  const updateGanttConfig = useCallback((updates) => {
    setGanttConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Toggle item selection
  const toggleItemSelection = useCallback((itemKey) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemKey)) {
        newSet.delete(itemKey);
      } else {
        newSet.add(itemKey);
      }
      return newSet;
    });
  }, []);

  // Select all items
  const selectAllItems = useCallback(() => {
    const allKeys = processedItems.map(item => item.key);
    setSelectedItems(new Set(allKeys));
  }, [processedItems]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  // Update filters
  const updateFilters = useCallback((filterUpdates) => {
    setFilters(prev => ({ ...prev, ...filterUpdates }));
  }, []);

  // Clear filters
  const clearFilters = useCallback(() => {
    setFilters({
      status: [],
      assignee: [],
      priority: [],
      dateRange: null
    });
  }, []);

  // Export Gantt data
  const exportGanttData = useCallback((format = 'json') => {
    const exportData = {
      config: ganttConfig,
      dateRange: effectiveDateRange,
      items: processedItems,
      groups: filteredGroups,
      metadata: {
        totalItems: processedItems.length,
        filteredItems: Object.values(filteredGroups).flat().length,
        dateFields,
        colorScheme,
        groupBy,
        exportedAt: new Date().toISOString()
      }
    };

    switch (format) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'csv':
        return convertToCSV(processedItems);
      default:
        return exportData;
    }
  }, [ganttConfig, effectiveDateRange, processedItems, filteredGroups, dateFields, colorScheme, groupBy]);

  // Convert to CSV format
  const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';

    const headers = ['key', 'summary', 'status', 'assignee', 'priority', 'startDate', 'endDate', 'duration'];
    const rows = data.map(item => [
      item.key,
      item.summary,
      item.status,
      item.assignee,
      item.priority,
      item.gantt.startDate ? formatters.date(item.gantt.startDate) : '',
      item.gantt.endDate ? formatters.date(item.gantt.endDate) : '',
      item.gantt.duration
    ]);

    return [headers, ...rows].map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
  };

  return {
    // Configuration
    ganttConfig,
    updateGanttConfig,
    
    // Data
    processedItems,
    groupedItems: filteredGroups,
    dateRange: effectiveDateRange,
    
    // Selection
    selectedItems,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    
    // Filtering
    filters,
    updateFilters,
    clearFilters,
    
    // Export
    exportGanttData,
    
    // Computed properties
    totalItems: processedItems.length,
    filteredItemCount: Object.values(filteredGroups).flat().length,
    hasSelection: selectedItems.size > 0,
    hasFilters: Object.values(filters).some(f => f && f.length > 0),
    
    // Statistics
    stats: {
      totalDuration: processedItems.reduce((sum, item) => sum + (item.gantt.duration || 0), 0),
      averageDuration: processedItems.length > 0 
        ? processedItems.reduce((sum, item) => sum + (item.gantt.duration || 0), 0) / processedItems.length 
        : 0,
      statusBreakdown: processedItems.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {})
    }
  };
};