import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  AboutInferenceBanner,
  AboutLine,
} from '../../components/Oncalls/OncallsParts';
import EscalationDrill from '../../components/Oncalls/EscalationDrill';

jest.mock('../../hooks/useOncallBlurbs', () => ({
  useOncallBlurbs: () => ({
    blurbs: {
      'ONCALL-1': { status: 'Open', pathHint: 'status "Open" · no TechHelp/eng path yet', comments: [] },
    },
    loading: false,
    error: null,
  }),
}));

describe('AboutLine / AboutInferenceBanner', () => {
  test('shows about without NAI limited badge', () => {
    render(<AboutLine about="Customer hit provisioning" pathHint={null} loading={false} />);
    expect(screen.getByText('Customer hit provisioning')).toBeTruthy();
    expect(screen.queryByText(/NAI limited/i)).toBeNull();
  });

  test('shows pathHint without NAI limited badge', () => {
    render(<AboutLine about={null} pathHint={'3d in "Open" · TechHelp only: TH-1'} loading={false} />);
    expect(screen.getByText(/TechHelp only/)).toBeTruthy();
    expect(screen.queryByText(/NAI limited/i)).toBeNull();
  });

  test('banner once when no about in set', () => {
    render(
      <AboutInferenceBanner
        keys={['ONCALL-1', 'ONCALL-2']}
        blurbs={{
          'ONCALL-1': { pathHint: 'x', comments: [] },
          'ONCALL-2': { pathHint: 'y', comments: [] },
        }}
        loading={false}
      />
    );
    expect(screen.getByText(/About unavailable/i)).toBeTruthy();
  });

  test('no banner when any about present', () => {
    render(
      <AboutInferenceBanner
        keys={['ONCALL-1']}
        blurbs={{ 'ONCALL-1': { about: 'Waiting on eng', comments: [] } }}
        loading={false}
      />
    );
    expect(screen.queryByText(/About unavailable/i)).toBeNull();
  });
});

describe('EscalationDrill status authenticity', () => {
  const rows = [
    {
      oncallKey: 'ONCALL-23895',
      oncallStatus: 'Closed',
      oncallAssignee: 'Mohit Anand',
      oncallSummary: 'seed',
      stillOpen: false,
      daysToResolve: 64,
      kpiNames: ['Non-Top-CFI'],
      linked: [
        {
          key: 'ERA-66893',
          status: 'Closed',
          summary: 'field ticket',
          stillOpen: false,
          daysToResolve: 64,
          kpiNames: ['Non-Top-CFI'],
        },
      ],
    },
  ];

  test('Closed field ticket shows Closed once — not fake Resolved', () => {
    render(
      <EscalationDrill
        mode="resolved"
        rows={rows}
        jiraBase="https://jira.nutanix.com"
        jql='key = ONCALL-23895'
        cellCount={1}
        kpiNames={['Non-Top-CFI']}
        teamId="ndb"
        seedStacks={[]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('ERA-66893')).toBeTruthy();
    const closedChips = screen.getAllByText('Closed');
    expect(closedChips.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Resolved')).toBeNull();
    expect(screen.getByText(/Field tickets done/i)).toBeTruthy();
  });
});
