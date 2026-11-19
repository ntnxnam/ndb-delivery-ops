import React from 'react';
import { useTeam } from '../../contexts/TeamContext';
import { TeamSelector } from './TeamSelector';

/**
 * Shared empty/loading/error gate for pages that need a selected team.
 * The sidebar always shows TeamSelector; this is the in-page fallback
 * when nothing is selected yet.
 */
export function TeamRequiredGate({
  title = 'Select a Team',
  description,
  selectorId = 'page-team-select',
}) {
  const { loading, hasTeamSelected, error } = useTeam();

  if (loading && !hasTeamSelected) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ backgroundColor: 'var(--info-soft, #e7f3ff)', padding: '2rem', borderRadius: 'var(--radius)', maxWidth: '400px', margin: '0 auto', border: '1px solid var(--accent-border, #bee5eb)' }}>
          <h3 style={{ color: 'var(--info, #0c5460)', margin: '0 0 1rem 0' }}>Loading teams</h3>
          <p style={{ color: 'var(--info, #0c5460)', margin: 0 }}>Fetching the team list…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <div style={{ backgroundColor: 'var(--warning-soft, #fff3cd)', padding: '2rem', borderRadius: 'var(--radius)', maxWidth: '600px', margin: '0 auto', border: '1px solid var(--warning-border, #ffe69c)' }}>
        <h2 style={{ color: 'var(--warning, #856404)', margin: '0 0 1rem 0' }}>{title}</h2>
        <p style={{ color: 'var(--warning, #856404)', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>
          {error
            ? error
            : 'Pick a team, then click Fetch to load this page.'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <TeamSelector variant="page" id={selectorId} />
        </div>
        {description && (
          <p style={{ color: 'var(--warning, #856404)', margin: 0, fontSize: '0.9rem' }}>{description}</p>
        )}
      </div>
    </div>
  );
}
