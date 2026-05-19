import React from 'react';
import { getUIColumnOrder, getColumnLabel, getColumnWidth } from '../utils/releaseVersionUtils';

/**
 * ReleaseVersionTableHeader Component
 * 
 * Renders table header row with column labels based on configuration
 * 
 * @param {Object} props
 * @param {Object} props.columnsConfig - Column configuration object
 */
function ReleaseVersionTableHeader({ columnsConfig }) {
  const uiColumnOrder = getUIColumnOrder(columnsConfig);
  // Only use columns from config - no fallback to prevent showing wrong columns
  const columnOrder = uiColumnOrder;

  return (
    <thead>
      <tr style={{ backgroundColor: '#e9ecef' }}>
        {columnOrder.map(columnKey => {
          const width = getColumnWidth(columnsConfig, columnKey);
          return (
            <th 
              key={columnKey}
              style={{ 
                padding: '6px', 
                border: '1px solid #dee2e6', 
                textAlign: 'left', 
                whiteSpace: 'normal', 
                wordWrap: 'break-word', 
                width: width || 'auto',
                backgroundColor: '#e9ecef', // Ensure background color for sticky header
                position: 'sticky',
                top: 0,
                zIndex: 100 // Ensure header appears above table body content
              }}
            >
              {getColumnLabel(columnsConfig, columnKey)}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export default ReleaseVersionTableHeader;

