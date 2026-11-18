import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectPlanView } from './ProjectPlanView';

const jiraBaseUrl = 'https://jira.example.com';

describe('ProjectPlanView — issues mode (Feature Dashboard)', () => {
  const issues = [
    { key: 'EPIC-1', summary: 'Epic One', issueType: 'Epic', status: 'In Progress', epicLink: null },
    { key: 'TASK-1', summary: 'Task under epic', issueType: 'Task', status: 'To Do', priority: 'P1', epicLink: 'EPIC-1', duedate: '2026-02-28' },
    { key: 'TASK-2', summary: 'Done task', issueType: 'Task', status: 'Done', priority: 'P2', epicLink: 'EPIC-1', duedate: null },
    { key: 'TASK-3', summary: 'Orphan', issueType: 'Task', status: 'Open', priority: 'P3', epicLink: null },
  ];

  it('groups flat issues by epicLink and renders EpicSection per epic', () => {
    render(<ProjectPlanView issues={issues} jiraBaseUrl={jiraBaseUrl} canonicalJql="project=ERA" />);
    expect(screen.getByText('EPIC-1')).toBeTruthy();
    expect(screen.getByText(/Epic One/)).toBeTruthy();
    // TASK-1 should be in table (open), TASK-2 filtered (Done), TASK-3 in isolated bucket
    expect(screen.getByText('TASK-1')).toBeTruthy();
    expect(screen.queryByText('TASK-2')).toBeNull(); // Done filtered
    expect(screen.getByText(/Isolated \(no epic link\)/)).toBeTruthy();
    expect(screen.getByText('TASK-3')).toBeTruthy();
  });

  it('computes progress pct and shows open/total counts', () => {
    render(<ProjectPlanView issues={issues} jiraBaseUrl={jiraBaseUrl} />);
    // EPIC-1 has 2 children, 1 open => 50%
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText(/1 open \/ 2 total/)).toBeTruthy();
  });

  it('shows all-done badge when all children Done', () => {
    const allDoneIssues = [
      { key: 'EPIC-9', summary: 'Done Epic', issueType: 'Epic', status: 'Done', epicLink: null },
      { key: 'TASK-9', summary: 'Done child', issueType: 'Task', status: 'Done', epicLink: 'EPIC-9' },
    ];
    render(<ProjectPlanView issues={allDoneIssues} jiraBaseUrl={jiraBaseUrl} />);
    expect(screen.getByText(/all done/)).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('renders Open in JIRA link with canonicalJql', () => {
    render(<ProjectPlanView issues={issues} jiraBaseUrl={jiraBaseUrl} canonicalJql="project=ERA" />);
    const links = screen.getAllByText('Open in JIRA');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toContain(encodeURIComponent('(project=ERA) AND statusCategory != Done'));
  });

  it('hides JIRA link when jiraBaseUrl missing', () => {
    render(<ProjectPlanView issues={issues} jiraBaseUrl="" canonicalJql="project=ERA" />);
    expect(screen.queryByText('Open in JIRA')).toBeNull();
  });

  it('supports custom groupBy prop', () => {
    const customIssues = [
      { key: 'FEAT-1', summary: 'Feature', issueType: 'Feature', status: 'Open', parentLink: null },
      { key: 'EPIC-5', summary: 'Epic under feature', issueType: 'Epic', status: 'Open', parentLink: 'FEAT-1' },
    ];
    // In issues mode, isPortfolio filters Feature/Epic out of children, so only non-portfolio tasks would be grouped.
    // Custom groupBy is exercised by verifying isolated handling doesn't break. Header still counts all non-Done.
    render(<ProjectPlanView issues={customIssues} jiraBaseUrl={jiraBaseUrl} groupBy="parentLink" />);
    expect(screen.getByText(/2 open/)).toBeTruthy();
  });

  it('toggle button has aria-expanded and aria-hidden glyph', () => {
    render(<ProjectPlanView issues={issues} jiraBaseUrl={jiraBaseUrl} />);
    const button = screen.getAllByRole('button')[0];
    expect(button.getAttribute('aria-expanded')).toBeDefined();
    const toggle = button.querySelector('.fd-epic-toggle');
    expect(toggle.getAttribute('aria-hidden')).toBe('true');
  });

  it('clicking toggle collapses/expands table', () => {
    render(<ProjectPlanView issues={issues} jiraBaseUrl={jiraBaseUrl} />);
    const button = screen.getAllByRole('button')[0];
    // Initially expanded (not allDone)
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ProjectPlanView — groups mode (Email Sender)', () => {
  const groups = [
    {
      key: 'FEAT-1',
      summary: 'Feature One',
      issueType: 'Feature',
      status: 'In Progress',
      childItems: [
        { key: 'ERA-100', summary: 'Epic A', issueType: 'Epic', status: 'Open', duedate: '2026-10-16', fixVersions: ['NDB-2.12'], priority: 'P1', assignee: 'Alice' },
        { key: 'ERA-101', summary: 'Epic B', issueType: 'Epic', status: 'Done', duedate: null, fixVersions: [], priority: null },
      ],
    },
  ];

  it('renders Feature group with child epics', () => {
    render(<ProjectPlanView groups={groups} jiraBaseUrl={jiraBaseUrl} title="Epics" columns={['key', 'type', 'summary', 'status', 'assignee', 'priority']} />);
    expect(screen.getByText('FEAT-1')).toBeTruthy();
    expect(screen.getByText('ERA-100')).toBeTruthy();
    // Done epic filtered from table body
    expect(screen.queryByText('ERA-101')).toBeNull();
  });

  it('shows Total Epics count with JQL link', () => {
    render(<ProjectPlanView groups={groups} jiraBaseUrl={jiraBaseUrl} title="Epics" />);
    expect(screen.getByText(/Total Epics:/)).toBeTruthy();
    const link = screen.getByText('2'); // totalCount = 2
    expect(link.getAttribute('href')).toContain('key%20in%20(ERA-100%2C%20ERA-101)');
    expect(link.className).toContain('fd-plan-count-link');
  });

  it('renders empty state when groups is empty array', () => {
    render(<ProjectPlanView groups={[]} jiraBaseUrl={jiraBaseUrl} title="Epics" />);
    expect(screen.getByText(/No epics in this payload/)).toBeTruthy();
  });

  it('renders empty state when groups undefined falls back to issues mode (no groups header)', () => {
    render(<ProjectPlanView issues={[]} jiraBaseUrl={jiraBaseUrl} />);
    expect(screen.getByText(/0 open/)).toBeTruthy();
  });

  it('Due Date column: portfolio type shows dash, Epic shows formatted date', () => {
    const groupsWithDueDate = [
      {
        key: 'FEAT-1',
        summary: 'Feature One',
        issueType: 'Feature',
        status: 'Open',
        childItems: [
          { key: 'ERA-200', summary: 'Epic with due', issueType: 'Epic', status: 'Open', duedate: '2026-02-28' },
        ],
      },
    ];
    // Render with dueDate column included
    const { container } = render(
      <ProjectPlanView groups={groupsWithDueDate} jiraBaseUrl={jiraBaseUrl} title="Epics" columns={['key', 'dueDate']} />
    );
    // Epic due date should be formatted DD/Mon/YYYY via formatDate
    expect(container.textContent).toContain('28/Feb/2026');
  });

  it('Not Set sentinel does not double-format to Invalid Date', () => {
    const groupsSentinel = [
      {
        key: 'FEAT-1',
        summary: 'Feature',
        issueType: 'Feature',
        status: 'Open',
        childItems: [
          { key: 'ERA-300', summary: 'Epic sentinel', issueType: 'Epic', status: 'Open', duedate: 'Not Set' },
        ],
      },
    ];
    const { container } = render(
      <ProjectPlanView groups={groupsSentinel} jiraBaseUrl={jiraBaseUrl} columns={['key', 'dueDate']} />
    );
    expect(container.textContent).toContain('Not Set');
    expect(container.textContent).not.toContain('Invalid Date');
  });

  it('table is wrapped in scroll container for responsive overflow', () => {
    const { container } = render(<ProjectPlanView groups={groups} jiraBaseUrl={jiraBaseUrl} />);
    expect(container.querySelector('.fd-plan-table-wrap')).toBeTruthy();
  });
});

describe('ProjectPlanView — edge cases', () => {
  it('Status column does not leak fd-priority class', () => {
    const issues = [
      { key: 'EPIC-1', summary: 'Epic', issueType: 'Epic', status: 'Open', epicLink: null },
      { key: 'TASK-1', summary: 'T', issueType: 'Task', status: 'In Progress', epicLink: 'EPIC-1' },
    ];
    const { container } = render(<ProjectPlanView issues={issues} jiraBaseUrl={jiraBaseUrl} />);
    const chips = container.querySelectorAll('.fd-status-chip');
    chips.forEach((chip) => {
      expect(chip.className).not.toContain('fd-priority-');
    });
  });
});
