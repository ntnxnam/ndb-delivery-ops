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
        <div style={{ backgroundColor: '#e7f3ff', padding: '2rem', borderRadius: '8px', maxWidth: '400px', margin: '0 auto' }}>
          <h3 style={{ color: '#0c5460', margin: '0 0 1rem 0' }}>Loading teams</h3>
          <p style={{ color: '#0c5460', margin: 0 }}>Fetching the team list…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <div style={{ backgroundColor: '#fff3cd', padding: '2rem', borderRadius: '8px', maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ color: '#856404', margin: '0 0 1rem 0' }}>{title}</h2>
        <p style={{ color: '#856404', margin: '0 0 1rem 0', fontSize: '1.1rem' }}>
          {error
            ? error
            : 'Choose a team in the sidebar (or below) to load this page.'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <TeamSelector variant="page" id={selectorId} />
        </div>
        {description && (
          <p style={{ color: '#856404', margin: 0, fontSize: '0.9rem' }}>{description}</p>
        )}
      </div>
    </div>
  );
}
