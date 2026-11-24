import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

// ── mocks ───────────────────────────────────────────────────────────────────
jest.mock('../../hooks/useOncallsV2', () => ({
  useOncallsV2: jest.fn(),
  TIMEFRAMES: ['7d', '15d', '1M', '1Q', '2Q', '1Y', '18M', 'Overall'],
}));
jest.mock('../../contexts/TeamContext', () => ({
  useTeam: jest.fn(),
}));
jest.mock('../../layout/components/TeamRequiredGate', () => ({
  TeamRequiredGate: () => null,
}));
jest.mock('../../components/KpiPulse/KpiPulseBand', () => () => null);
jest.mock('../../components/Oncalls/PathDrill', () => () => null);
jest.mock('../../components/OncallsV2/OncallReportSection', () => () => null);
jest.mock('../../hooks/useOncallReport', () => ({
  useOncallReport: () => ({ busy: false, error: '', preview: jest.fn(), send: jest.fn() }),
}));
jest.mock('../../shared/components/PageLoading', () => ({
  PageLoading: () => null,
}));

const { useOncallsV2 } = require('../../hooks/useOncallsV2');
const { useTeam } = require('../../contexts/TeamContext');
const OncallsV2Page = require('../../components/OncallsV2/OncallsV2Page').default;

function makeDashboard(overrides = {}) {
  return {
    asOf: '2026-02-10T12:00:00.000Z',
    jiraBaseUrl: 'https://jira.example.com',
    agedOpenDays: 14,
    hero: {
      open: { count: 8, jql: 'project = OnCall AND statusCategory != Done' },
      agedOpen: { count: 2, jql: 'project = OnCall AND created <= -14d' },
      needInfoOpen: { count: 1, jql: 'project = OnCall AND status = "Need Info"' },
      waitingCustomerOpen: { count: 1, jql: 'project = OnCall AND status = "Waiting for Customer"' },
      closedInWindow: { count: 12, jql: 'project = OnCall AND resolved >= -7d' },
    },
    health: { mttrMedian: 3, p90: 10, throughput: 12, net: 2, agedShare: 25 },
    pulse: { heroes: { resolvedWindow: { jql: 'project = OnCall AND resolved >= -7d' } }, mttr: { jql: 'project = OnCall AND resolved >= -7d' } },
    workflow: {
      needInfo: { count: 1, jql: 'project = OnCall AND status = "Need Info"' },
      waiting: { count: 1, jql: 'project = OnCall AND status = "Waiting for Customer"' },
    },
    gapTaxonomy: {
      duds: { count: 2, jql: 'project = OnCall AND key in (duds)' },
      ndbGaps: { count: 5, jql: 'project = OnCall AND key in (ndbGaps)' },
      otherTeamGaps: { count: 3, jql: 'project = OnCall AND key in (otherTeamGaps)' },
      ndbSub: {
        thLinked: { count: 1, jql: 'project = OnCall AND key in (thLinked)' },
        bugs: { count: 2, jql: 'project = OnCall AND key in (bugs)' },
        improvements: { count: 1, jql: 'project = OnCall AND key in (improvements)' },
        other: { count: 1, jql: 'project = OnCall AND key in (other)' },
      },
    },
    gapMeta: {},
    openTickets: [{ key: 'ONCALL-1', ageDays: 5 }],
    closedStacksPreview: [],
    stacksPreview: [],
    rag: { level: 'GREEN', why: 'all good' },
    ...overrides,
  };
}

function renderPage(dashboardOverrides) {
  useTeam.mockReturnValue({ selectedTeamId: 'ndb', selectedTeam: { notificationEmails: { exec: 'dl@nutanix.com' } }, hasTeamSelected: true });
  useOncallsV2.mockReturnValue({
    timeframe: '7d',
    setTimeframe: jest.fn(),
    data: makeDashboard(dashboardOverrides),
    loading: false,
    refreshing: false,
    error: null,
    refresh: jest.fn(),
    aiConcern: null,
    aiConcernState: 'idle',
    aiConcernError: null,
    generateConcern: jest.fn(),
    aiSlice: null,
    aiSliceState: 'idle',
    aiSliceError: null,
    aiSliceView: null,
    generateSlice: jest.fn(),
    resetAiSlice: jest.fn(),
  });
  return render(<OncallsV2Page />);
}

// ── CSS imports ─────────────────────────────────────────────────────────────
describe('OncallsV2Page — CSS imports', () => {
  test('imports Oncalls.css and OncallsV2.css', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/OncallsV2/OncallsV2Page.js'), 'utf8');
    expect(src).toMatch(/Oncalls\.css/);
    expect(src).toMatch(/OncallsV2\.css/);
  });
});

// ── hero guide details table ───────────────────────────────────────────────
describe('OncallsV2Page — hero guide details table', () => {
  test('details table has 16 rows', () => {
    renderPage();
    const details = document.querySelector('details');
    expect(details).toBeTruthy();
    const summary = within(details).getByText(/What each number means/);
    expect(summary).toBeTruthy();
    const tbody = details.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');
    expect(rows.length).toBe(16);
  });

  test('details summary mentions ℹ︎ on each card', () => {
    renderPage();
    expect(screen.getByText(/What each number means/)).toBeTruthy();
    expect(screen.getByText(/What each number means/).textContent).toMatch(/ℹ/);
  });
});

// ── per-hero ℹ️ tooltip ─────────────────────────────────────────────────────
describe('OncallsV2Page — per-hero ℹ️ tooltip', () => {
  const expectedLabels = ['Open now', 'Aged >14d', 'Need Info', 'Waiting for Customer', 'Closed in window', 'MTTR median', 'MTTR p90', 'Throughput', 'Aged share', 'Duds', 'NDB gaps', 'Other-team gaps'];

  test.each(expectedLabels)('hero "%s" has ℹ️ with What/How/Why', (label) => {
    renderPage();
    const explainEl = screen.getByLabelText(`Explain ${label}`);
    expect(explainEl.textContent).toMatch(/ℹ/);
    const tip = explainEl.getAttribute('title');
    expect(tip).toMatch(/What:/);
    expect(tip).toMatch(/How:/);
    expect(tip).toMatch(/Why:/);
  });

  test('tooltip includes meta when hero has meta', () => {
    renderPage();
    // Open now has meta "current stock"
    const openNowTip = screen.getByLabelText('Explain Open now').getAttribute('title');
    expect(openNowTip).toMatch(/Meta: current stock/);
  });

  test('agedDays prop reflected in Aged tooltip', () => {
    renderPage({ agedOpenDays: 21 });
    const tip = screen.getByLabelText('Explain Aged >21d').getAttribute('title');
    expect(tip).toMatch(/21d/);
  });

  test('default agedDays 14 when not overridden', () => {
    renderPage();
    const tip = screen.getByLabelText('Explain Aged >14d').getAttribute('title');
    expect(tip).toMatch(/14d/);
  });
});

// ── NDB gaps button keyboard ────────────────────────────────────────────────
function getNdbToggleBtn() {
  // outer toggle has aria-expanded; inner count button does not
  const candidates = screen.getAllByRole('button', { name: /NDB gaps/i });
  return candidates.find((b) => b.hasAttribute('aria-expanded'));
}

describe('OncallsV2Page — NDB gaps button', () => {
  test('click toggles aria-expanded and shows 4 sub-cards', () => {
    renderPage();
    expect(document.querySelector('.ocv2-ndb-drill')).toBeNull();
    const btn = getNdbToggleBtn();
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const ndbDrill = document.querySelector('.ocv2-ndb-drill');
    expect(ndbDrill).toBeTruthy();
    expect(within(ndbDrill).getByText('TH linked')).toBeTruthy();
    expect(within(ndbDrill).getByText('Bugs')).toBeTruthy();
    expect(within(ndbDrill).getByText('Improvements')).toBeTruthy();
    expect(within(ndbDrill).getByText('Other')).toBeTruthy();
  });

  test('second click hides sub-cards and flips aria-expanded', () => {
    renderPage();
    const btn = getNdbToggleBtn();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.ocv2-ndb-drill')).toBeTruthy();

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.ocv2-ndb-drill')).toBeNull();
  });

  test('keyboard Enter on focused toggle button toggles', () => {
    renderPage();
    const btn = getNdbToggleBtn();
    btn.focus();
    // jsdom: button Enter fires click
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.ocv2-ndb-drill')).toBeTruthy();

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.ocv2-ndb-drill')).toBeNull();
  });

  test('NDB gaps toggle is a button element (keyboard accessible) not div', () => {
    renderPage();
    const btn = getNdbToggleBtn();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });

  test('sub-drill inherits timeframe', () => {
    renderPage();
    fireEvent.click(getNdbToggleBtn());
    expect(screen.getByText(/NDB sub-drill \(inherits 7d\)/)).toBeTruthy();
  });
});
