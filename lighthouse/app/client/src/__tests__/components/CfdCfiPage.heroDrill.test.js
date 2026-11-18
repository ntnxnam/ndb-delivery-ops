import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('../../utils/api', () => ({
  authenticatedGet: jest.fn(),
  authenticatedPost: jest.fn(),
  getApiBase: jest.fn(() => ''),
}));
jest.mock('../../hooks/useCfdCfi', () => ({
  useCfdCfi: jest.fn(),
}));
jest.mock('../../contexts/TeamContext', () => ({
  useTeam: jest.fn(),
}));
jest.mock('../../layout/components/TeamRequiredGate', () => ({
  TeamRequiredGate: () => null,
}));
jest.mock('../../auth/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
jest.mock('../../hooks/useExecPageBriefing', () => ({
  useExecPageBriefing: () => ({
    enabled: false,
    loading: false,
    summary: null,
    error: null,
    generate: jest.fn(),
  }),
}));
jest.mock('../../components/ExecPageBriefing', () => () => null);
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

const { useCfdCfi } = require('../../hooks/useCfdCfi');
const { useTeam } = require('../../contexts/TeamContext');
const CfdCfiPage = require('../../components/CfdCfiPage').default;

const OPEN_JQL = 'filter=142537 AND statusCategory != Done';

const mockKpi = {
  id: 'kpi_top_cfd',
  name: 'Top-CFD',
  baseQuery: 'filter=142537',
  combinedJql: 'filter=142537',
  pulse: {
    agedOpenDays: 14,
    story: 'Catching up.',
    heroes: {
      openNow: { count: 2, jql: OPEN_JQL },
      agedOpen: { count: 1, jql: `${OPEN_JQL} AND created <= -14d` },
      createdWindow: { count: 5, jql: 'filter=142537 AND created >= "2026-01-01"' },
      resolvedWindow: { count: 6, jql: 'filter=142537 AND resolved >= "2026-01-01"' },
      netBurn: { count: 1, jql: null, label: '+1' },
      mttrMedian: { count: 3, unit: 'days', jql: 'filter=142537 AND resolved >= "2026-01-01"' },
      mttrP90: { count: 10, unit: 'days', jql: 'filter=142537 AND resolved >= "2026-01-01"' },
      topDwellStatus: { status: null, count: null, jql: null },
    },
    series: [],
    statusDwell: [],
    productImpact: { summary: null, citations: [] },
  },
  openTickets: {
    total: 2,
    truncated: false,
    jql: OPEN_JQL,
    issues: [
      {
        key: 'ERA-90001',
        summary: 'Sample CFD ticket',
        status: 'Open',
        priority: 'Major - P2',
        assignee: 'alice',
        ageDays: 5,
      },
      {
        key: 'ERA-90002',
        summary: 'Aged CFD ticket',
        status: 'In Progress',
        priority: 'Blocker - P0',
        assignee: 'bob',
        ageDays: 20,
      },
    ],
  },
};

function renderPage() {
  useTeam.mockReturnValue({
    selectedTeamId: 'ndb',
    hasTeamSelected: true,
  });
  useCfdCfi.mockReturnValue({
    data: {
      success: true,
      teamId: 'ndb',
      jiraBaseUrl: 'https://jira.example.com',
      kpiNamePattern: 'CFD|CFI',
      asOf: '2026-10-16T12:00:00.000Z',
      kpis: [mockKpi],
    },
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
  });

  return render(<CfdCfiPage />);
}

describe('CfdCfiPage hero → in-page drill', () => {
  test('Open now hero click opens drawer with ticket rows and JIRA proof', () => {
    renderPage();

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show Open now: 2/i }));

    expect(screen.getByRole('dialog', { name: /Open now — Top-CFD/i })).toBeTruthy();
    expect(screen.getByText('ERA-90001')).toBeTruthy();
    expect(screen.getByText('ERA-90002')).toBeTruthy();
    expect(screen.getByText('Sample CFD ticket')).toBeTruthy();

    const proof = screen.getByRole('link', { name: /Open matching tickets in JIRA/i });
    expect(proof.getAttribute('href')).toContain(encodeURIComponent(OPEN_JQL));
    expect(proof.getAttribute('target')).toBe('_blank');
  });

  test('Open now tile keeps secondary Open in JIRA hint', () => {
    renderPage();
    const hint = screen.getByRole('link', { name: /Open Open now in JIRA/i });
    expect(hint.getAttribute('href')).toContain('jql=');
  });

  test('Created / Resolved counts link to JIRA — no popup (OnCalls Created/Closed pattern)', () => {
    renderPage();

    const created = screen.getByRole('link', { name: '5' });
    expect(created.getAttribute('href')).toContain(
      encodeURIComponent('filter=142537 AND created >= "2026-01-01"')
    );
    expect(screen.queryByRole('button', { name: /Show Created:/i })).toBeNull();

    const resolved = screen.getByRole('link', { name: '6' });
    expect(resolved.getAttribute('href')).toContain(
      encodeURIComponent('filter=142537 AND resolved >= "2026-01-01"')
    );
    expect(screen.queryByRole('button', { name: /Show Resolved:/i })).toBeNull();

    fireEvent.click(created);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
