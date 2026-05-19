import * as XLSX from 'xlsx';

/**
 * Export data to Excel file with customizable options
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Name of the file to download
 * @param {Object} options - Export options
 * @param {string} options.worksheetName - Name of the worksheet
 * @param {Array} options.columns - Column definitions with key and header
 * @returns {Promise<void>}
 */
export const exportToExcel = async (data, filename, options = {}) => {
  const {
    worksheetName = 'Data',
    columns = null
  } = options;

  try {
    // Create a new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for export
    let exportData = data;
    
    // If columns are specified, filter and reorder data
    if (columns && Array.isArray(columns)) {
      exportData = data.map(row => {
        const newRow = {};
        columns.forEach(col => {
          newRow[col.header] = row[col.key] ?? '';
        });
        return newRow;
      });
    }

    // Create worksheet from data
    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Auto-size columns
    const colWidths = [];
    if (exportData.length > 0) {
      const headers = Object.keys(exportData[0]);
      headers.forEach((header, index) => {
        const maxLength = Math.max(
          header.length,
          ...exportData.map(row => String(row[header] || '').length)
        );
        colWidths[index] = { wch: Math.min(maxLength + 2, 50) }; // Cap at 50 chars
      });
      worksheet['!cols'] = colWidths;
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);

    // Write file and trigger download
    XLSX.writeFile(workbook, filename);

    return Promise.resolve();
  } catch (error) {
    console.error('Excel export error:', error);
    throw new Error(`Failed to export Excel file: ${error.message}`);
  }
};

/**
 * Export multiple sheets to a single Excel file
 * @param {Array} sheets - Array of sheet objects {name, data, columns?}
 * @param {string} filename - Name of the file to download
 * @returns {Promise<void>}
 */
export const exportMultipleSheetsToExcel = async (sheets, filename) => {
  try {
    const workbook = XLSX.utils.book_new();

    sheets.forEach(sheet => {
      const { name, data, columns } = sheet;
      
      let exportData = data;
      
      // If columns are specified, filter and reorder data
      if (columns && Array.isArray(columns)) {
        exportData = data.map(row => {
          const newRow = {};
          columns.forEach(col => {
            newRow[col.header] = row[col.key] ?? '';
          });
          return newRow;
        });
      }

      // Create worksheet
      const worksheet = XLSX.utils.json_to_sheet(exportData);

      // Auto-size columns
      const colWidths = [];
      if (exportData.length > 0) {
        const headers = Object.keys(exportData[0]);
        headers.forEach((header, index) => {
          const maxLength = Math.max(
            header.length,
            ...exportData.map(row => String(row[header] || '').length)
          );
          colWidths[index] = { wch: Math.min(maxLength + 2, 50) };
        });
        worksheet['!cols'] = colWidths;
      }

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    });

    // Write file and trigger download
    XLSX.writeFile(workbook, filename);

    return Promise.resolve();
  } catch (error) {
    console.error('Multi-sheet Excel export error:', error);
    throw new Error(`Failed to export multi-sheet Excel file: ${error.message}`);
  }
};

/**
 * Export release analysis data with formatted columns
 * @param {Array} data - Processed analysis data
 * @param {string} filename - Name of the file to download
 * @returns {Promise<void>}
 */
export const exportReleaseAnalysisToExcel = async (data, filename) => {
  const sheets = [
    {
      name: 'Ticket Analysis',
      data,
      columns: [
        { key: 'issueKey', header: 'Issue Key' },
        { key: 'issueType', header: 'Issue Type' },
        { key: 'status', header: 'Status' },
        { key: 'statusCategory', header: 'Status Category' },
        { key: 'resolvedDate', header: 'Resolved Date' },
        { key: 'release', header: 'Release' },
        { key: 'issueTypeCategory', header: 'Issue Type Category' },
        { key: 'weekBin', header: '3-Week Bin' },
        { key: 'binStartDate', header: 'Bin Start Date' },
        { key: 'binEndDate', header: 'Bin End Date' }
      ]
    }
  ];

  // Add summary data if available
  if (data.length > 0) {
    const summaryData = generateSummaryData(data);
    sheets.push({
      name: 'Summary',
      data: summaryData,
      columns: [
        { key: 'metric', header: 'Metric' },
        { key: 'value', header: 'Value' },
        { key: 'description', header: 'Description' }
      ]
    });
  }

  return exportMultipleSheetsToExcel(sheets, filename);
};

/**
 * Generate summary data for the analysis
 * @param {Array} data - Processed analysis data
 * @returns {Array} Summary data
 */
const generateSummaryData = (data) => {
  const releases = [...new Set(data.map(d => d.release))];
  const issueTypes = [...new Set(data.map(d => d.issueTypeCategory))];
  const bins = [...new Set(data.map(d => d.weekBin))];

  const summaryData = [
    {
      metric: 'Total Tickets',
      value: data.length,
      description: 'Total number of tickets analyzed'
    },
    {
      metric: 'Releases Analyzed',
      value: releases.length,
      description: releases.join(', ')
    },
    {
      metric: 'Issue Type Categories',
      value: issueTypes.length,
      description: issueTypes.join(', ')
    },
    {
      metric: '3-Week Bins',
      value: bins.length,
      description: 'Number of 3-week time periods covered'
    }
  ];

  // Add per-release counts
  releases.forEach(release => {
    const count = data.filter(d => d.release === release).length;
    summaryData.push({
      metric: `${release} Tickets`,
      value: count,
      description: `Tickets resolved for ${release} release`
    });
  });

  // Add per-issue-type counts
  issueTypes.forEach(type => {
    const count = data.filter(d => d.issueTypeCategory === type).length;
    summaryData.push({
      metric: `${type} Issues`,
      value: count,
      description: `Total ${type.toLowerCase()} tickets across all releases`
    });
  });

  return summaryData;
};