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
