import React from 'react';
import { formatRiskWithHistory } from '../../utils/riskHistoryDisplay';

export function RiskIndicatorCell({ itemKey, currentRisk, checkpointHistory }) {
  return formatRiskWithHistory(itemKey, currentRisk, checkpointHistory) || <span style={{ color: '#9e9e9e' }}>{currentRisk || 'Not Set'}</span>;
}
