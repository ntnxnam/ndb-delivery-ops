import React, { useMemo } from 'react';
import ReleaseVersionTableCell from './ReleaseVersionTableCell';
import { 
  getUIColumnOrder, 
  isDateOlderThan
} from '../utils/releaseVersionUtils';
import { generateExecutiveSummary } from '../utils/generateExecutiveSummary';

/**
 * ReleaseVersionTableRow Component
 * 
 * Renders a single table row for a JIRA item with row highlighting logic
 * 
 * @param {Object} props
 * @param {Object} props.item - JIRA item object
 * @param {Object} props.columnsConfig - Column configuration object
 * @param {string} props.selectedVersion - Selected release version
 * @param {Object} props.checkpointHistory - Checkpoint history data
 * @param {string} props.jiraBaseUrl - JIRA base URL for links
 * @param {Object} props.ganttConfig - Gantt configuration
 * @param {Map} props.breakdownDataMap - Map of JIRA key to breakdown data
 * @param {boolean} props.loadingBreakdowns - Whether breakdown data is loading
 */
const ReleaseVersionTableRow = React.memo(function ReleaseVersionTableRow({ 
  item, 
  columnsConfig, 
  selectedVersion, 
  checkpointHistory, 
  jiraBaseUrl,
  ganttConfig,
  breakdownDataMap,
  loadingBreakdowns
}) {
  // Generate executive summary for this specific item (memoized)
  const itemExecutiveSummary = useMemo(() => generateExecutiveSummary({
    item,
    releaseVersion: selectedVersion,
    ganttConfig
  }), [item, selectedVersion, ganttConfig]);
  // Check if Status Update Date is older than 10 days or empty (for row highlighting)
  let statusUpdateDateValue = item.customfield_45660;
  if (statusUpdateDateValue && typeof statusUpdateDateValue === 'object' && !(statusUpdateDateValue instanceof Date)) {
    statusUpdateDateValue = statusUpdateDateValue.value || statusUpdateDateValue.date || statusUpdateDateValue;
  }
  const isStatusUpdateEmpty = !statusUpdateDateValue || statusUpdateDateValue === null || statusUpdateDateValue === undefined || String(statusUpdateDateValue).trim() === '';
  const isStatusUpdateOld = statusUpdateDateValue ? isDateOlderThan(statusUpdateDateValue, 10) : false;
  const shouldHighlightRow = isStatusUpdateEmpty || isStatusUpdateOld;
  
  // Get UI column order from config
  const uiColumnOrder = getUIColumnOrder(columnsConfig);
  
  // If no config or no columns, don't render (wait for config to load)
  if (!columnsConfig || uiColumnOrder.length === 0) {
    return null;
  }
  
  // Render cells based on UI column order using ReleaseVersionTableCell
  return (
    <tr 
      key={item.key}
      style={shouldHighlightRow ? {
        border: '2px solid #de350b',
        boxShadow: '0 0 0 1px #de350b'
      } : {}}
    >
      {uiColumnOrder.map(columnKey => (
        <ReleaseVersionTableCell
          key={columnKey}
          item={item}
          columnKey={columnKey}
          columnsConfig={columnsConfig}
          selectedVersion={selectedVersion}
          checkpointHistory={checkpointHistory}
          jiraBaseUrl={jiraBaseUrl}
          itemExecutiveSummary={itemExecutiveSummary}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          loadingBreakdowns={loadingBreakdowns}
        />
      ))}
    </tr>
  );
});

export default ReleaseVersionTableRow;

