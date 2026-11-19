import React from 'react';
import { formatRiskWithHistory, RAG_COLORS, riskWord, getRagColor } from '../../utils/riskHistoryDisplay';

/**
 * Shared RiskIndicatorTrail — single SoT for RAG badge + trail.
 * Used by both Project Status (compact stacked Risk Details) and SoS (dashboard RAG dot).
 * Visual differentiation stays in callers; this component only provides badge+trail primitives.
 */

export function RiskBadge({ value }) {
  const word = riskWord(value);
  if (!word || word === 'Not Set' || word === 'N/A') {
    return <span style={{ color: '#999', fontStyle: 'italic' }}>Not Set</span>;
  }
  const color = RAG_COLORS[word] || '#616161';
  // Use same badge colours as ReleaseVersionTableCell for consistency
  return <span style={{ backgroundColor: color, color: '#fff', padding: '2px 6px', borderRadius: '3px', fontSize: '11px', fontWeight: 600 }}>{word}</span>;
}

export function RiskTrail({ itemKey, currentRisk, checkpointHistory }) {
  const trail = formatRiskWithHistory(itemKey, currentRisk, checkpointHistory);
  if (!trail) return null;
  return <span style={{ marginLeft: '6px' }}>{trail}</span>;
}

/**
 * Combined badge + trail inline. Caller chooses layout.
 */
export function RiskIndicatorCell({ itemKey, currentRisk, checkpointHistory, variant = 'compact' }) {
  // variant: 'compact' (Project Status stacked) vs 'dashboard' (SoS dot+trail) — caller wraps layout
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
      <RiskBadge value={currentRisk} />
      <RiskTrail itemKey={itemKey} currentRisk={currentRisk} checkpointHistory={checkpointHistory} />
    </span>
  );
}

export default RiskIndicatorCell;
