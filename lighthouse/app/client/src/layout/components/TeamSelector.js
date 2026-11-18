import React from 'react';
import { useTeam } from '../../contexts/TeamContext';

const PAGE_SELECT_STYLE = {
  padding: '0.4rem',
  fontSize: '0.85rem',
  minWidth: '160px',
  maxWidth: '240px',
};

const PAGE_CHOOSE_STYLE = {
  height: '32px',
  padding: '0 14px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  background: '#f9fafb',
  color: '#374151',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * Shared team dropdown used by the sidebar and page toolbars.
 * Changing the dropdown only stages a team; Fetch applies it
 * and reloads team-scoped data on every page.
 */
export function TeamSelector({ variant = 'page', id = 'team-select' }) {
  const {
    teams,
    pendingTeamId,
    setPendingTeamId,
    applyTeam,
    isTransitioning,
    loading,
    error,
    fetchTeams,
  } = useTeam();

  const isSidebar = variant === 'sidebar';
  const wrapperStyle = isSidebar
    ? undefined
    : { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginRight: '12px' };
  const selectClass = isSidebar
    ? `team-select ${isTransitioning ? 'transitioning' : ''}`
    : 'text-input';

  const label = (
    <label htmlFor={id} style={isSidebar ? undefined : { margin: 0, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
      Team:
    </label>
  );

  if (loading && teams.length === 0) {
    return (
      <div className={isSidebar ? 'team-selector' : undefined} style={wrapperStyle}>
        {label}
        <span style={{ fontSize: '0.85rem', color: isSidebar ? '#ccc' : '#6c757d', fontStyle: 'italic' }}>
          Loading teams…
        </span>
      </div>
    );
  }

  if (error && teams.length === 0) {
    return (
      <div className={isSidebar ? 'team-selector' : undefined} style={wrapperStyle}>
        {label}
        <span style={{ fontSize: '0.8rem', color: isSidebar ? '#f8d7da' : '#721c24' }}>
          Couldn’t load teams
        </span>
        <button
          type="button"
          onClick={() => fetchTeams({ force: true })}
          style={{
            padding: '0.25rem 0.6rem',
            fontSize: '0.8rem',
            cursor: 'pointer',
            border: isSidebar ? '1px solid #adb5bd' : '1px solid #ced4da',
            background: isSidebar ? 'transparent' : '#fff',
            color: isSidebar ? '#fff' : '#333',
            borderRadius: '4px',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className={isSidebar ? 'team-selector' : undefined} style={wrapperStyle}>
        {label}
        <span style={{ fontSize: '0.85rem', color: isSidebar ? '#ccc' : '#6c757d' }}>
          No teams configured
        </span>
      </div>
    );
  }

  const stagedId = pendingTeamId || '';
  const fetchTitle = "Load this team's versions from its base filter";

  return (
    <div className={isSidebar ? 'team-selector' : undefined} style={wrapperStyle}>
      {label}
      <select
        id={id}
        value={stagedId}
        onChange={(e) => setPendingTeamId(e.target.value)}
        className={selectClass}
        style={isSidebar ? undefined : PAGE_SELECT_STYLE}
        disabled={loading || isTransitioning}
      >
        {!stagedId && <option value="">Select a team…</option>}
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="team-choose-btn"
        style={isSidebar ? undefined : PAGE_CHOOSE_STYLE}
        disabled={!stagedId || isTransitioning}
        onClick={() => applyTeam(stagedId)}
        title={fetchTitle}
      >
        Fetch
      </button>
      {isTransitioning && <span className={isSidebar ? 'transition-indicator' : undefined}>⏳</span>}
    </div>
  );
}
