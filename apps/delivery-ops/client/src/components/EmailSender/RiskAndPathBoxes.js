import React from 'react';
import { fieldDisplayValue } from './gateDateUtils';

/**
 * Three read-only boxes: Risk Indicator | Risk Assessment | Path to Green.
 * Placed below Highlights and Lowlights on Email Sender.
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

  const boxStyle = {
    flex: '1 1 0',
    minWidth: '180px',
    border: '1px solid #dee2e6',
    borderRadius: '4px',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyle = {
    padding: '8px 10px',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#1a1a1a',
    background: '#f8f9fa',
    borderBottom: '1px solid #dee2e6',
  };

  const bodyStyle = (unset) => ({
    padding: '10px 12px',
    fontSize: '0.875rem',
    lineHeight: 1.5,
    color: '#1a1a1a',
    minHeight: '72px',
    backgroundColor: unset ? '#fff3cd' : 'transparent',
    fontWeight: unset ? 600 : 400,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    flex: 1,
  });

  return (
    <div className="form-group" style={{ marginTop: '0.75rem' }}>
      <label style={{ marginBottom: '0.5rem' }}>Risk context (from JIRA)</label>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={boxStyle}>
          <div style={headerStyle}>{risk?.name || 'Risk Indicator'}</div>
          <div
            style={{
              ...bodyStyle(riskUnset),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              backgroundColor: riskUnset ? '#fff3cd' : (riskColor || 'transparent'),
              color: !riskUnset && riskColor ? '#ffffff' : '#1a1a1a',
              fontWeight: 600,
            }}
          >
            {riskValue}
          </div>
        </div>

        <div style={boxStyle}>
          <div style={headerStyle}>{assessment?.name || 'Risk Assessment'}</div>
          <div style={bodyStyle(assessmentUnset)}>{assessmentValue}</div>
        </div>

        <div style={boxStyle}>
          <div style={headerStyle}>{pathToGreen?.name || 'Path to Green'}</div>
          <div style={bodyStyle(pathUnset)}>{pathValue}</div>
        </div>
      </div>
      <small className="help-text">
        Read-only from JIRA. Update the ticket fields if these need to change.
      </small>
    </div>
  );
}

export default RiskAndPathBoxes;
