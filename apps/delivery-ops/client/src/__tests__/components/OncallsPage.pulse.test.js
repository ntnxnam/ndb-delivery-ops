import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OncallsPage from '../../components/OncallsPage';

const mockOpenPath = jest.fn();

jest.mock('../../hooks/useOncalls', () => ({
  useOncalls: () => ({
    data: {
      asOf: '2026-11-02T12:00:00.000Z',
      jiraBaseUrl: 'https://jira.nutanix.com',
      agedOpenDays: 14,
      rag: { level: 'GREEN', why: 'ok' },
      pulse: {
        window: { label: 'last 2 Qs' },
        story: 'Catching up on OnCalls.',
        heroes: {
          openNow: { count: 3, jql: 'project = OnCall AND statusCategory != Done' },
          agedOpen: { count: 1, jql: 'aged' },
          p0Open: { count: 0, jql: 'p0' },
          p1Open: { count: 0, jql: 'p1' },
          createdWindow: { count: 5, jql: 'created' },
          resolvedWindow: { count: 4, jql: 'resolved' },
        },
        series: [],
        mttr: { medianDays: 2, p90Days: 5, sampleSize: 4, jql: null },
        statusDwell: [],
      },
      hero: { open: { count: 3, jql: 'open' } },
      paths: {},
      past: { lookbackDays: 30, tickets: [], paths: {} },
      openTickets: [],
      assigneeMix: [],
      priorityMix: [],
    },
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
    aiState: 'idle',
    aiSummary: null,
    aiIntelligence: null,
    aiError: null,
    generateBriefing: jest.fn(),
  }),
}));

jest.mock('../../contexts/TeamContext', () => ({
  useTeam: () => ({ selectedTeamId: 'ndb', hasTeamSelected: true }),
}));

jest.mock('../../auth/hooks/usePermissions', () => ({
  usePermissions: () => ({ isExecAudience: false }),
}));

jest.mock('../../hooks/useExecPageBriefing', () => ({
  useExecPageBriefing: () => ({
    state: 'idle',
    summary: null,
    meta: null,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock('../../components/KpiPulse/KpiPulseBand', () => {
  return function MockBand({ pulse, onHeroClick, title }) {
    return (
      <div data-testid="kpi-pulse-band">
        <span>{title}</span>
        <span>{pulse?.story}</span>
        <button type="button" onClick={() => onHeroClick('openNow', pulse.heroes.openNow)}>
          Open now {pulse.heroes.openNow.count}
        </button>
      </div>
    );
  };
});

jest.mock('../../components/Oncalls/PathDrill', () => {
  return function MockPathDrill({ mode }) {
    if (!mode) return null;
    mockOpenPath(mode);
    return <div data-testid="path-drill">path:{mode}</div>;
  };
});

jest.mock('../../components/Oncalls/EscalationDrill', () => () => null);
jest.mock('../../components/ExecPageBriefing', () => () => null);
jest.mock('../../layout/components/TeamRequiredGate', () => ({
  TeamRequiredGate: () => null,
}));

describe('OncallsPage pulse kit', () => {
  beforeEach(() => mockOpenPath.mockClear());

  test('mounts KpiPulseBand and open-family click opens PathDrill', () => {
    render(<OncallsPage />);
    expect(screen.getByTestId('kpi-pulse-band')).toBeTruthy();
    expect(screen.getByText(/OnCalls · last 2 Nutanix Qs/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open now 3/i }));
    expect(screen.getByTestId('path-drill').textContent).toContain('path:open');
  });
});
