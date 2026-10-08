import React from 'react';
import { fieldDisplayValue } from './gateDateUtils';

/**
 * Compact risk row: Indicator | Assessment | Path to Green.
 */
function RiskAndPathBoxes({ jiraData }) {
  if (!jiraData) return null;

  const risk = jiraData.customfield_23560;
  const assessment = jiraData.customfield_47780;
  const pathToGreen = jiraData.customfield_55664;

  const riskValue = fieldDisplayValue(risk);
  const assessmentValue = fieldDisplayValue(assessment);
  const pathValue = fieldDisplayValue(pathToGreen);

  const riskColor = risk?.color || null;
  const riskUnset = !riskValue || riskValue === 'Not Set';
  const assessmentUnset = !assessmentValue || assessmentValue === 'Not Set';
  const pathUnset = !pathValue || pathValue === 'Not Set';

  const cell = (unset) => ({
    padding: '6px 8px',
    fontSize: '0.8125rem',
    lineHeight: 1.35,
    backgroundColor: unset ? '#fff3cd' : 'transparent',
    fontWeight: unset ? 600 : 400,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '4.5rem',
    overflowY: 'auto',
  });

  return (
    <div className="form-group" style={{ marginTop: '0.35rem' }}>
      <label style={{ marginBottom: '0.3rem' }}>Risk</label>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(110px, 0.7fr) 1.4fr 1.4fr',
          gap: 0,
          border: '1px solid #dee2e6',
          borderRadius: '4px',
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <div style={{ borderRight: '1px solid #dee2e6' }}>
          <div style={{ padding: '4px 8px', fontSize: '0.7rem', fontWeight: 600, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
            {risk?.name || 'Indicator'}
          </div>
          <div
            style={{
              ...cell(riskUnset),
              textAlign: 'center',
              backgroundColor: riskUnset ? '#fff3cd' : (riskColor || 'transparent'),
              color: !riskUnset && riskColor ? '#fff' : '#1a1a1a',
              fontWeight: 700,
            }}
          >
            {riskValue}
          </div>
        </div>
        <div style={{ borderRight: '1px solid #dee2e6' }}>
          <div style={{ padding: '4px 8px', fontSize: '0.7rem', fontWeight: 600, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
            {assessment?.name || 'Assessment'}
          </div>
          <div style={cell(assessmentUnset)}>{assessmentValue}</div>
        </div>
        <div>
          <div style={{ padding: '4px 8px', fontSize: '0.7rem', fontWeight: 600, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
            {pathToGreen?.name || 'Path to Green'}
          </div>
          <div style={cell(pathUnset)}>{pathValue}</div>
        </div>
      </div>
    </div>
  );
}

export default RiskAndPathBoxes;
