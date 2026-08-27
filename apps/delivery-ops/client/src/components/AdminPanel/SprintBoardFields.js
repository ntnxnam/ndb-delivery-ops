import React, { useState } from 'react';
import { authenticatedPost } from '../../utils/api';

const fieldStyle = (hasError) => ({
  width: '100%',
  padding: '8px',
  border: `1px solid ${hasError ? '#ef4444' : '#d1d5db'}`,
  borderRadius: '4px',
  fontSize: '14px'
});

const labelStyle = {
  display: 'block',
  fontSize: '14px',
  fontWeight: '500',
  marginBottom: '4px'
};

function SprintBoardFields({ formData, patchFormData, validation }) {
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState(null);
  const [boardMeta, setBoardMeta] = useState(null);

  const detectFromBoard = async () => {
    if (!formData.boardId) return;
    setDetecting(true);
    setDetectError(null);
    setBoardMeta(null);
    try {
      const jiraToken = localStorage.getItem('jiraToken');
      const response = await authenticatedPost(
        '/api/admin/validate-board',
        { boardId: Number(formData.boardId), jiraToken },
        { jiraToken, username: localStorage.getItem('username') || '' }
      );
      const calendar = response.data.sprintCalendar || {};
      patchFormData({
        s1StartIso: calendar.s1StartIso || '',
        sprintDays: calendar.sprintDays || ''
      });
      setBoardMeta({
        name: response.data.board?.name,
        sprintCount: response.data.sprintCount,
        namedS1: response.data.inferredFrom?.namedS1
      });
    } catch (error) {
      setDetectError(
        error.response?.data?.message || error.message || 'Could not read sprints from this board'
      );
    }
    setDetecting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        backgroundColor: '#eff6ff',
        border: '1px solid #dbeafe',
        borderRadius: '4px',
        padding: '12px'
      }}>
        <p style={{ margin: 0, fontSize: '13px', color: '#1e40af', lineHeight: 1.45 }}>
          Sprint calendar (S1 start + length) is required for velocity, forecast, and release sync.
          Enter a JIRA board ID and detect it from the board, or fill the dates manually.
        </p>
      </div>

      <div>
        <label style={labelStyle}>JIRA Sprint Board ID *</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="number"
            style={fieldStyle(validation.boardId)}
            value={formData.boardId || ''}
            onChange={(e) => patchFormData({ boardId: e.target.value })}
            placeholder="e.g., 2888"
          />
          <button
            type="button"
            onClick={detectFromBoard}
            disabled={!formData.boardId || detecting}
            style={{
              padding: '8px 16px',
              backgroundColor: (!formData.boardId || detecting) ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (!formData.boardId || detecting) ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              whiteSpace: 'nowrap'
            }}
          >
            {detecting ? 'Detecting…' : 'Detect from board'}
          </button>
        </div>
        {validation.boardId && (
          <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>{validation.boardId}</p>
        )}
        <p style={{ color: '#6b7280', fontSize: '13px', marginTop: '4px', marginBottom: 0 }}>
          Agile board whose sprints define this team&apos;s cadence.
        </p>
        {boardMeta && (
          <p style={{ color: '#166534', fontSize: '13px', marginTop: '6px', marginBottom: 0 }}>
            ✓ {boardMeta.name || 'Board'} — {boardMeta.sprintCount} sprints
            {boardMeta.namedS1 ? ' (used named S1)' : ' (used earliest sprint as S1)'}
          </p>
        )}
        {detectError && (
          <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>{detectError}</p>
        )}
      </div>

      <div>
        <label style={labelStyle}>S1 start date *</label>
        <input
          type="date"
          style={fieldStyle(validation.s1StartIso)}
          value={formData.s1StartIso || ''}
          onChange={(e) => patchFormData({ s1StartIso: e.target.value })}
        />
        {validation.s1StartIso && (
          <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>{validation.s1StartIso}</p>
        )}
        <p style={{ color: '#6b7280', fontSize: '13px', marginTop: '4px', marginBottom: 0 }}>
          Anchor date for sprint 1 (ISO). Detect from the board or enter the team&apos;s S1 Wednesday.
        </p>
      </div>

      <div>
        <label style={labelStyle}>Sprint length (days) *</label>
        <input
          type="number"
          min={1}
          max={90}
          style={fieldStyle(validation.sprintDays)}
          value={formData.sprintDays || ''}
          onChange={(e) => patchFormData({ sprintDays: e.target.value })}
          placeholder="typically 14 or 21"
        />
        {validation.sprintDays && (
          <p style={{ color: '#ef4444', fontSize: '14px', marginTop: '4px' }}>{validation.sprintDays}</p>
        )}
      </div>
    </div>
  );
}

export default SprintBoardFields;
