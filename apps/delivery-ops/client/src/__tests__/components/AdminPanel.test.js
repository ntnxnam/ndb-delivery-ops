import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPanel from '../../components/AdminPanel/AdminPanel';
import TeamForm, { slugifyTeamId } from '../../components/AdminPanel/TeamForm';
import * as api from '../../utils/api';

jest.mock('../../utils/api');

const mockTeamContext = {
  replaceTeams: jest.fn(),
  upsertTeam: jest.fn(),
  updateTeam: jest.fn(),
};
jest.mock('../../contexts/TeamContext', () => ({
  useTeam: () => mockTeamContext,
}));

const mockLocalStorage = {
  getItem: jest.fn((key) => {
    if (key === 'jiraToken') return 'test-token';
    if (key === 'username') return 'admin';
    return null;
  }),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const CALENDAR = { s1StartIso: '2020-02-20', sprintDays: 14 };

const NCN_TEAM = {
  id: 'ncn',
  name: 'Nutanix Cloud Native',
  projectKey: 'NCN',
  boardId: 4741,
  baseFilter: 'filter=NCN-All-Base-Filter and statusCategory!=Done',
  sprintScope: 'filter=NCN-All-Base-Filter',
  sprintCalendar: CALENDAR,
  featureComponents: { NKP: ['NKP-Core'] },
  kpiCount: 2,
};

const DETECTED = {
  success: true,
  baseFilter: 'filter=DL and statusCategory!=Done',
  sprintScope: 'filter=DL',
  issueCount: 900,
  sampledCount: 500,
  projects: [
    { key: 'DL', name: 'DataLens', count: 450, share: 90 },
    { key: 'ENG', name: 'Engineering', count: 50, share: 10 },
  ],
  projectKey: 'DL',
  projectShare: 90,
  versions: { total: 4, unreleasedCount: 2, unreleased: ['DL-2.0', 'DL-1.9'] },
  board: { boards: [{ id: 77, name: 'DL Scrum' }, { id: 78, name: 'DL Kanban-ish' }], boardId: 77, sprintCalendar: CALENDAR },
  feature: {
    projectKey: 'FEAT',
    issueCount: 12,
    components: [
      { name: 'DataLens', count: 10, primaryComponents: ['DL-Core', 'DL-UI'], suggested: true },
      { name: 'Analytics', count: 2, primaryComponents: [], suggested: true },
      { name: 'ux', count: 1, primaryComponents: [], suggested: false },
    ],
    featureComponents: { DataLens: ['DL-Core', 'DL-UI'], Analytics: [], ux: [] },
  },
};

describe('AdminPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the loading state', () => {
    api.authenticatedGet.mockReturnValue(new Promise(() => {}));
    render(<AdminPanel />);
    expect(screen.getByText('Loading teams...')).toBeInTheDocument();
  });

  it('shows access denied when the API refuses', async () => {
    api.authenticatedGet.mockRejectedValue({ response: { data: { message: 'Access denied.' } } });
    render(<AdminPanel />);
    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText('Access denied.')).toBeInTheDocument();
  });

  it('lists teams with sprint scope and components, and syncs the team picker', async () => {
    api.authenticatedGet.mockResolvedValue({ data: { success: true, teams: [NCN_TEAM] } });
    render(<AdminPanel />);
    expect(await screen.findByText('Nutanix Cloud Native')).toBeInTheDocument();
    expect(screen.getByText('filter=NCN-All-Base-Filter')).toBeInTheDocument();
    expect(screen.getByText('NKP-Core')).toBeInTheDocument();
    expect(screen.queryByText(/Dedicated|Parent Project|Version Patterns|User Access/)).not.toBeInTheDocument();
    expect(mockTeamContext.replaceTeams).toHaveBeenCalledWith([
      expect.not.objectContaining({ kpiCount: expect.anything(), sprintScope: expect.anything() }),
    ]);
  });

  it('runs the configuration test through the admin API', async () => {
    api.authenticatedGet.mockResolvedValue({ data: { success: true, teams: [NCN_TEAM] } });
    api.authenticatedPost.mockResolvedValue({
      data: {
        success: true,
        results: {
          projectAccess: { valid: true, projectName: 'Cloud Native' },
          versionAccess: { valid: true, totalVersions: 3 },
          baseFilter: { valid: true, issueCount: 120 },
          sprintScope: { valid: false, error: 'Bad JQL' },
        },
      },
    });
    render(<AdminPanel />);
    fireEvent.click(await screen.findByText('🔍 Test'));
    expect(await screen.findByText('✓ 3 unreleased')).toBeInTheDocument();
    expect(screen.getByText('✗ Bad JQL')).toBeInTheDocument();
    expect(api.authenticatedPost).toHaveBeenCalledWith('/api/admin/test-team-config', { teamId: 'ncn' }, expect.any(Object));
  });

  it('opens the add-team form', async () => {
    api.authenticatedGet.mockResolvedValue({ data: { success: true, teams: [NCN_TEAM] } });
    render(<AdminPanel />);
    fireEvent.click(await screen.findByText('+ Add team'));
    expect(screen.getByRole('heading', { name: 'Add team' })).toBeInTheDocument();
  });
});

describe('TeamForm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('slugifies team names into codes', () => {
    expect(slugifyTeamId('Data Lens / Platform')).toBe('data-lens-platform');
  });

  it('fills the code from the name until the code is edited', () => {
    render(<TeamForm onSave={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Data Lens' } });
    expect(screen.getByLabelText('Team code')).toHaveValue('data-lens');
    fireEvent.change(screen.getByLabelText('Team code'), { target: { value: 'DL' } });
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Data Lens 2' } });
    expect(screen.getByLabelText('Team code')).toHaveValue('dl');
  });

  it('requires Detect before creating, then saves detected settings', async () => {
    const onSave = jest.fn().mockResolvedValue({});
    api.authenticatedPost.mockResolvedValue({ data: DETECTED });
    render(<TeamForm onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Data Lens' } });
    fireEvent.change(screen.getByLabelText('Base filter (JQL)'), { target: { value: 'filter=DL and statusCategory!=Done' } });
    expect(screen.getByText('Create team')).toBeDisabled();

    fireEvent.click(screen.getByText('Detect'));
    expect(await screen.findByText('DL-UI')).toBeInTheDocument();
    expect(api.authenticatedPost).toHaveBeenCalledWith(
      '/api/admin/inspect-base-filter',
      expect.objectContaining({ baseFilter: 'filter=DL and statusCategory!=Done', name: 'Data Lens' }),
      expect.any(Object)
    );
    expect(screen.getByText(/S1 starts 2020-02-20/)).toBeInTheDocument();

    expect(screen.getByLabelText(/DataLens/)).toBeChecked();
    expect(screen.getByLabelText(/^ux/)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(/Analytics/));
    fireEvent.click(screen.getByText('Create team'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      {
        id: 'data-lens',
        name: 'Data Lens',
        baseFilter: 'filter=DL and statusCategory!=Done',
        projectKey: 'DL',
        boardId: 77,
        sprintCalendar: CALENDAR,
        featureComponents: { DataLens: ['DL-Core', 'DL-UI'] },
      },
      null
    );
  });

  it('re-reads the sprint calendar when another board is picked', async () => {
    api.authenticatedPost
      .mockResolvedValueOnce({ data: DETECTED })
      .mockResolvedValueOnce({ data: { boardId: 78, sprintCalendar: { s1StartIso: '2025-01-01', sprintDays: 21 } } });
    render(<TeamForm onSave={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Base filter (JQL)'), { target: { value: 'filter=DL' } });
    fireEvent.click(screen.getByText('Detect'));
    fireEvent.change(await screen.findByLabelText('Sprint board'), { target: { value: '78' } });
    expect(await screen.findByText(/S1 starts 2025-01-01/)).toBeInTheDocument();
    expect(api.authenticatedPost).toHaveBeenLastCalledWith('/api/admin/board-calendar', { boardId: '78' }, expect.any(Object));
  });

  it('shows the server message when Detect fails', async () => {
    api.authenticatedPost.mockRejectedValue({ response: { status: 400, data: { error: 'Base filter matched no tickets' } } });
    render(<TeamForm onSave={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Base filter (JQL)'), { target: { value: 'filter=none' } });
    fireEvent.click(screen.getByText('Detect'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Base filter matched no tickets');
  });

  it('edits a team without re-detecting when the base filter is unchanged', async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<TeamForm initialTeam={NCN_TEAM} onSave={onSave} onCancel={jest.fn()} />);
    expect(screen.getByLabelText('Team code')).toHaveAttribute('readonly');
    expect(screen.getByText(/Current: Project NCN · board 4741/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'NCN' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      {
        name: 'NCN',
        baseFilter: NCN_TEAM.baseFilter,
        projectKey: 'NCN',
        boardId: 4741,
        sprintCalendar: CALENDAR,
      },
      'ncn'
    ));

    fireEvent.change(screen.getByLabelText('Base filter (JQL)'), { target: { value: 'filter=Other' } });
    expect(screen.getByText('Save changes')).toBeDisabled();
    expect(screen.getByText('Run Detect on this base filter before saving.')).toBeInTheDocument();
  });

  it('shows save errors from the server', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Team already exists'));
    api.authenticatedPost.mockResolvedValue({ data: DETECTED });
    render(<TeamForm onSave={onSave} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'NDB' } });
    fireEvent.change(screen.getByLabelText('Base filter (JQL)'), { target: { value: 'filter=DL' } });
    fireEvent.click(screen.getByText('Detect'));
    await screen.findByText('DL-UI');
    fireEvent.click(screen.getByText('Create team'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Team already exists');
  });
});
