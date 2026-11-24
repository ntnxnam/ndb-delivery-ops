/**
 * Sidebar navigation — grouped for caret expansion.
 * Icons are Lucide component names resolved in Sidebar (group headers only).
 */

function getBinPackingUrl() {
  // Bin-packing runs standalone on 8890 (not on 8001) — see apps/bin-packing/package.json
  const binPackingPort = process.env.REACT_APP_BINPACKING_PORT || '8890';
  if (typeof window === 'undefined') return '/bin-packing/';
  const isDevReactServer = window.location.port === '8899';
  if (!isDevReactServer) return `//${window.location.hostname}:${binPackingPort}/`;
  return `${window.location.protocol}//${window.location.hostname}:${binPackingPort}/`;
}

function getProjectPlanCreatorUrl() {
  return (
    process.env.REACT_APP_PROJECT_PLAN_CREATOR_URL ||
    'http://shuryakumar-ns.r8.ubvm.nutanix.com:8080/'
  );
}

/**
 * @typedef {{ path: string, label: string, description?: string, external?: boolean, newTab?: boolean, wip?: boolean }} NavItem
 * @typedef {{ id: string, label: string, icon: string, children: NavItem[], wip?: boolean }} NavGroup
 */

/** @type {NavGroup[]} */
export const SIDEBAR_NAV_GROUPS = [
  {
    id: 'release-admin',
    label: 'Release admin',
    icon: 'SlidersHorizontal',
    wip: true,
    children: [
      {
        path: '/release-config',
        label: 'Release Config',
        description: 'Move gate dates, view date history',
        wip: true,
      },
      {
        path: '/release-setup',
        label: 'Release Setup',
        description: 'Create / rename releases, cleanup filters',
      },
    ],
  },
  {
    id: 'release-tracking',
    label: 'Release tracking',
    icon: 'Layers',
    children: [
      {
        path: '/project-status',
        label: 'Project Status',
        description: 'Release picker, payload table, Gantt',
      },
      {
        path: '/sos-summary',
        label: 'SoS Summary',
        description:
          'Scrum of Scrums — live Feature/Initiative status across all active releases',
      },
      {
        path: '/sos-leader-summary',
        label: 'SoS by Leader',
        description: 'SoS regrouped by eng leader',
      },
      {
        path: '/component-report',
        label: 'Component Report',
        description: 'Component health, actionable metrics, deferral trends',
      },
      {
        path: '/dependency-view',
        label: 'Post EC dependency',
        description: 'Read-only partnership and companion dependencies',
      },
      {
        path: '/release-outstanding-work',
        label: 'Release Outstanding Work',
        description: 'Post-PG deferral process and outstanding Dev / QA / discipline work',
      },
    ],
  },
  {
    id: 'release-intelligence',
    label: 'Release intelligence',
    icon: 'BrainCircuit',
    wip: true,
    children: [
      {
        path: '/release/brief',
        label: 'Release Brief',
        description: 'Current-release AI health briefing and KPI snapshot',
      },
      {
        path: '/release/weekly-skim',
        label: 'Weekly Skim',
        description:
          'ADHD multi-release email skim — type chips, NAI pulse, HTML/PDF export',
      },
      {
        path: '/release/retrospective',
        label: 'Retrospective',
        description: 'Past-release gate compliance and behavior',
      },
      {
        path: '/chatbot',
        label: 'AI Chatbot',
        description: 'Conversational release and ticket Q&A',
      },
    ],
  },
  {
    id: 'feature-management',
    label: 'Feature management',
    icon: 'Kanban',
    children: [
      {
        path: '/',
        label: 'Email Sender',
        description: 'Send status update emails',
      },
      {
        path: '/feature-dashboard',
        label: 'Feature Dashboard',
        description: 'Feature payload, gates, reconciliation, and burn',
      },
    ],
  },
  {
    id: 'sprint',
    label: 'Sprint',
    icon: 'Timer',
    children: [
      {
        path: '/sprint-report',
        label: 'Sprint Report',
        description: 'Sprint reporting and metrics',
      },
      {
        path: '/sprint-performance',
        label: 'Sprint Performance',
        description:
          'Leadership view: say/do by scrum team, leader and manager across the last six sprints',
      },
    ],
  },
  {
    id: 'quality-kpis',
    label: 'Quality / KPIs',
    icon: 'BarChart2',
    children: [
      {
        path: '/oncalls',
        label: 'OnCalls',
        description: 'OnCall → TechHelp → eng-fix metrics and AI briefing',
      },
      {
        path: '/oncalls-next',
        label: 'OnCalls V2',
        description: 'VP-first timeframe + AI concern (pills global)',
      },
      {
        path: '/cfdcfi',
        label: 'CFD / CFI',
        description: 'CFD and CFI KPI pulse — heroes, trends, open tickets',
      },
      {
        path: '/system-test-scale',
        label: 'System-Test Scale',
        description:
          'System-Test bug scale, regressions, and release trends',
      },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: 'Wrench',
    children: [
      {
        path: '/generic-emailer',
        label: 'JIRA Emailer',
        description: 'Send emails from JIRA queries',
      },
      {
        path: '/email-history',
        label: 'Email History',
        description: 'View sent email history',
      },
      {
        path: getBinPackingUrl(),
        label: 'Bin Packing',
        description: 'Project bin-packing Gantt (opens in new tab)',
        external: true,
        newTab: true,
      },
      {
        path: getProjectPlanCreatorUrl(),
        label: 'Project Plan Creator',
        description: 'External project plan creator (opens in new tab)',
        external: true,
        newTab: true,
      },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: 'Users',
    children: [
      {
        path: '/kpis',
        label: 'KPIs',
        description: 'KPI dashboard and config',
      },
      {
        path: '/team-management',
        label: 'Team Management',
        description: 'Add and edit teams',
      },
    ],
  },
  {
    id: 'tpm',
    label: 'TPM',
    icon: 'Timer',
    wip: true,
    children: [
      { path: '/tpm/pulse', label: 'Pulse', description: '4 lifecycle cards per release + gate strip (you land here)', wip: true },
      { path: '/schedules', label: 'Schedules', description: 'TPM digest — what runs when', wip: true },
      { path: '/tpm/jql-builder', label: 'JQL Builder', description: 'Plaintext → healthy JQL from our KPIs', wip: true },
    ],
  },
];

export function isNavItemActive(pathname, path) {
  if (path === '/') {
    return pathname === '/';
  }
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/bin-packing')) {
    return false;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function findActiveGroupId(pathname, groups) {
  for (const group of groups) {
    for (const child of group.children) {
      if (!child.external && isNavItemActive(pathname, child.path)) {
        return group.id;
      }
    }
  }
  return null;
}
