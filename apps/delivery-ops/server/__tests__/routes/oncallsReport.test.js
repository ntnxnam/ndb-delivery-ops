jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, _res, next) => {
    req.jiraToken = 'test-token';
    req.username = 'test.user';
    next();
  },
}));
jest.mock('../../services/userService', () => ({
  checkKpiViewAuthorization: jest.fn().mockReturnValue({ authorized: true }),
}));
jest.mock('../../services/emailService', () => ({
  sendEmailDirect: jest.fn().mockResolvedValue({ messageId: '<msg-1>', accepted: ['a@nutanix.com'], rejected: [] }),
}));
jest.mock('../../services/oncallDashboardV2', () => ({
  TIMEFRAMES: { '7d': 7, '15d': 15, '1M': 30, '1Q': 90, '2Q': 180, '1Y': 365, '18M': 540, Overall: null },
  getDashboard: jest.fn(),
  timeframeToDays: jest.fn((tf) => ({ Overall: null, '7d': 7 }[tf] ?? 7)),
  timeframeClause: jest.fn((field, tf) => (tf === 'Overall' ? null : `${field} >= -7d`)),
}));
jest.mock('../../services/oncallConfigResolve', () => ({
  resolveRuntimeConfig: jest.fn((teamId) => ({ teamId: teamId || 'ndb', baseScopeJql: 'filter = NDB-OnCalls' })),
  loadConfig: jest.fn(() => ({})),
}));

const request = require('supertest');
const app = require('../../index');
const { sendEmailDirect } = require('../../services/emailService');
const { getDashboard } = require('../../services/oncallDashboardV2');
const { checkKpiViewAuthorization } = require('../../services/userService');

const AUTH = { Authorization: 'Bearer fake-pat' };

function fakeDashboard(overrides = {}) {
  return {
    teamId: 'ndb',
    timeframe: '7d',
    jiraBaseUrl: 'https://jira.nutanix.com',
    hero: {
      open: { count: 5, jql: 'project = OnCall AND statusCategory != Done' },
      agedOpen: { count: 2, jql: 'project = OnCall AND created <= -14d' },
      closedInWindow: { count: 8, jql: 'project = OnCall AND statusCategory = Done AND resolved >= -7d' },
    },
    health: { mttrMedian: 3, p90: 10, throughput: 8, net: 1 },
    gapTaxonomy: { duds: { count: 1, jql: 'duds' }, ndbGaps: { count: 2 }, otherTeamGaps: { count: 1 } },
    openTickets: [{ key: 'ONCALL-1', summary: 's', status: 'Open', priority: 'Major', assignee: 'Alice', ageDays: 5 }],
    closedStacksPreview: [],
    rag: { level: 'YELLOW', why: '2 aged' },
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function extractJqls(html) {
  const hrefs = [...String(html).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const jqls = [];
  for (const href of hrefs) {
    try {
      const url = new URL(href, 'https://jira.nutanix.com');
      const jql = url.searchParams.get('jql');
      if (jql) jqls.push(decodeURIComponent(jql));
    } catch {}
    // fallback: parse jql= param manually
    const m = href.match(/[?&]jql=([^"&]+)/);
    if (m) {
      try { jqls.push(decodeURIComponent(m[1])); } catch {}
    }
  }
  // deduplicate
  return [...new Set(jqls)];
}

function extractJiraAnchors(html) {
  return [...String(html).matchAll(/<a\s+[^>]*href="https:\/\/jira\.nutanix\.com[^"]*"[^>]*>/gi)].map((m) => m[0]);
}

describe('POST /api/jira/oncalls/report — auth gate', () => {
  beforeEach(() => jest.clearAllMocks());
  test('without kpi_view → 403 and getDashboard not called', async () => {
    // route fetches dashboard only when missing or hero missing; we provide dashboard passthrough so getDashboard would not be called anyway — but auth gate must block before any fetch
    checkKpiViewAuthorization.mockReturnValueOnce({ authorized: false });
    // ensure getDashboard would be observable if called
    getDashboard.mockResolvedValue(fakeDashboard());

    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: fakeDashboard() });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/kpi.*view|access denied/i);
    expect(getDashboard).not.toHaveBeenCalled();
    expect(sendEmailDirect).not.toHaveBeenCalled();
  });

  test('without kpi_view even with no dashboard passthrough → 403 and getDashboard not called', async () => {
    checkKpiViewAuthorization.mockReturnValueOnce({ authorized: false });
    getDashboard.mockResolvedValue(fakeDashboard());
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true });
    expect(res.status).toBe(403);
    expect(getDashboard).not.toHaveBeenCalled();
  });
});

describe('POST /api/jira/oncalls/report — payload guard', () => {
  beforeEach(() => jest.clearAllMocks());
  test('dashboard >200KB → 413 dashboard payload too large (getDashboard not called)', async () => {
    getDashboard.mockResolvedValue(fakeDashboard());
    const big = fakeDashboard();
    // build payload that JSON.stringify > 200KB
    big.openTickets = Array.from({ length: 800 }, (_, i) => ({ key: `ONCALL-${i}`, summary: 'x'.repeat(250), status: 'Open', priority: 'Major', assignee: 'Alice', ageDays: 5 }));
    const size = JSON.stringify(big).length;
    expect(size).toBeGreaterThan(200000);

    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: big });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/dashboard payload too large/i);
    expect(getDashboard).not.toHaveBeenCalled();
    expect(sendEmailDirect).not.toHaveBeenCalled();
  });

  test('aiConcern 5001 → 413', async () => {
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: fakeDashboard(), aiConcern: 'x'.repeat(5001) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/aiConcern too long/i);
    expect(getDashboard).not.toHaveBeenCalled();
  });

  test('aiConcern 5000 → 200 and HTML contains sliced 5000', async () => {
    const concern = 'A'.repeat(5000);
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: fakeDashboard(), aiConcern: concern });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.html).toContain('A'.repeat(100)); // sanity - contains slice
    // full 5000 should be present (escaped but As are safe)
    expect(res.body.data.html).toContain('A'.repeat(5000).slice(0, 500));
    // ensure service sliced correctly - if we sent 5000 it should pass through unchanged
    expect(getDashboard).not.toHaveBeenCalled();
  });

  test('aiConcern exactly 5000 does not trigger guard', async () => {
    getDashboard.mockResolvedValue(fakeDashboard());
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: fakeDashboard(), aiConcern: 'y'.repeat(5000) });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/jira/oncalls/report — timeframe', () => {
  beforeEach(() => jest.clearAllMocks());

  test('overall/OVERALL normalized to Overall in response', async () => {
    getDashboard.mockResolvedValue(fakeDashboard({ timeframe: 'Overall' }));
    for (const input of ['overall', 'OVERALL', 'Overall', 'overAll']) {
      jest.clearAllMocks();
      getDashboard.mockResolvedValue(fakeDashboard({ timeframe: 'Overall' }));
      const res = await request(app)
        .post('/api/jira/oncalls/report')
        .set(AUTH)
        .send({ teamId: 'ndb', timeframe: input, previewOnly: true, dashboard: fakeDashboard({ timeframe: 'Overall' }) });
      expect(res.status).toBe(200);
      expect(res.body.data.timeframe).toBe('Overall');
    }
  });

  test('Overall JQL has no resolved >= (decode hero hrefs)', async () => {
    // No dashboard passthrough → server re-fetches via getDashboard with normalized timeframe
    getDashboard.mockImplementation(async ({ timeframe }) => {
      expect(timeframe).toBe('Overall');
      const closedJql = 'project = OnCall AND statusCategory = Done'; // no date clause
      return fakeDashboard({
        timeframe: 'Overall',
        hero: {
          open: { count: 10, jql: 'project = OnCall AND statusCategory != Done' },
          agedOpen: { count: 2, jql: 'project = OnCall AND created <= -14d' },
          closedInWindow: { count: 50, jql: closedJql },
        },
      });
    });
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: 'overall', previewOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.data.timeframe).toBe('Overall');
    const jqls = extractJqls(res.body.data.html);
    expect(jqls.length).toBeGreaterThan(0);
    for (const jql of jqls) {
      expect(jql).not.toMatch(/resolved\s*>=/i);
    }
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ timeframe: 'Overall' }));
  });

  test('7d has resolved >= in closedInWindow JQL (decode hero hrefs)', async () => {
    getDashboard.mockImplementation(async ({ timeframe }) => {
      expect(timeframe).toBe('7d');
      const closedJql = 'project = OnCall AND statusCategory = Done AND resolved >= -7d';
      return fakeDashboard({
        timeframe: '7d',
        hero: {
          open: { count: 10, jql: 'project = OnCall AND statusCategory != Done' },
          agedOpen: { count: 2, jql: 'project = OnCall AND created <= -14d' },
          closedInWindow: { count: 5, jql: closedJql },
        },
      });
    });
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true });
    expect(res.status).toBe(200);
    expect(res.body.data.timeframe).toBe('7d');
    const jqls = extractJqls(res.body.data.html);
    // at least one JQL should contain resolved >=
    expect(jqls.some((j) => /resolved\s*>=/i.test(j))).toBe(true);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ timeframe: '7d' }));
  });
});

describe('POST /api/jira/oncalls/report — CC trust', () => {
  beforeEach(() => jest.clearAllMocks());
  test('client cc evil@x.com ignored, sendEmailDirect called with defaults.cc', async () => {
    getDashboard.mockResolvedValue(fakeDashboard());
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: false, dashboard: fakeDashboard(), cc: ['evil@x.com'], to: ['to@nutanix.com'] });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(sendEmailDirect).toHaveBeenCalledTimes(1);
    const args = sendEmailDirect.mock.calls[0][0];
    // client cc must be ignored
    expect(String(args.cc || '')).not.toMatch(/evil/i);
    expect(String(args.to || '')).not.toMatch(/evil/i);
    // defaults.cc from oncallReportService/defaultRecipients → leadershipCc fallback includes ndb-tech-leads/managers
    expect(String(args.cc).toLowerCase()).toContain('ndb-tech-leads@nutanix.com');
    expect(String(args.cc).toLowerCase()).toContain('ndb-managers@nutanix.com');
  });

  test('client cc object ignored even when to is overridden', async () => {
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: false, dashboard: fakeDashboard(), cc: 'evil@x.com', to: 'custom@nutanix.com' });
    expect(res.status).toBe(200);
    const args = sendEmailDirect.mock.calls[0][0];
    expect(args.cc).not.toMatch(/evil/i);
    expect(args.to).toContain('custom@nutanix.com');
  });
});

describe('POST /api/jira/oncalls/report — HTML safety', () => {
  beforeEach(() => jest.clearAllMocks());

  test('teamId="<b>" escaped in html', async () => {
    // resolveRuntimeConfig returns teamId as provided, so '<b>' flows to tid and html
    const { resolveRuntimeConfig } = require('../../services/oncallConfigResolve');
    resolveRuntimeConfig.mockReturnValueOnce({ teamId: '<b>', baseScopeJql: 'filter = X' });

    const dash = fakeDashboard({ teamId: '<b>' });
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: '<b>', timeframe: '7d', previewOnly: true, dashboard: dash });

    expect(res.status).toBe(200);
    const html = res.body.data.html;
    expect(html).toContain('&lt;b&gt;');
    // raw <b> tag from injection should not appear (template uses <strong>, not <b>)
    // Be precise: ensure the escaped teamId appears and no unescaped <b> injection
    expect(html).not.toContain('<b>');
    // Also ensure &lt;b&gt; appears in h1 title
    expect(html).toMatch(/OnCalls — &lt;b&gt;/);
  });

  test('subject CRLF stripped', async () => {
    const { resolveRuntimeConfig } = require('../../services/oncallConfigResolve');
    // teamId with CRLF injection
    const injected = 'ndb\r\nBcc: evil@x.com';
    resolveRuntimeConfig.mockReturnValueOnce({ teamId: injected, baseScopeJql: 'filter = X' });

    const dash = fakeDashboard();
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: injected, timeframe: '7d', previewOnly: true, dashboard: dash });

    expect(res.status).toBe(200);
    const subject = res.body.data.subject;
    expect(subject).not.toMatch(/[\r\n]/);
    // CRLF replaced with space
    expect(subject).toContain('ndb Bcc: evil@x.com');
    expect(subject).not.toContain('\r');
    expect(subject).not.toContain('\n');
  });

  test('every JIRA <a> has target="_blank"', async () => {
    const dash = fakeDashboard({
      hero: {
        open: { count: 5, jql: 'project = OnCall' },
        agedOpen: { count: 2, jql: 'project = OnCall AND aged' },
        closedInWindow: { count: 3, jql: 'project = OnCall AND resolved >= -7d' },
      },
      openTickets: [{ key: 'ONCALL-9', summary: 'Test <x>', status: 'Open', priority: 'Major', assignee: 'Alice', ageDays: 3 }],
      closedStacksPreview: [{ key: 'ONCALL-10', summary: 'Closed', status: 'Done', resolution: 'Fixed' }],
    });
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: dash });

    expect(res.status).toBe(200);
    const html = res.body.data.html;
    const anchors = extractJiraAnchors(html);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a).toMatch(/target="_blank"/);
    }
    // also ensure no JIRA link is missing target
    const withoutTarget = [...html.matchAll(/<a\s+[^>]*href="https:\/\/jira\.nutanix\.com[^"]*"[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => !/target="_blank"/.test(tag));
    expect(withoutTarget).toEqual([]);
  });
});

describe('POST /api/jira/oncalls/report — preview vs send', () => {
  beforeEach(() => jest.clearAllMocks());

  test('previewOnly true → preview:true html, send not called', async () => {
    const dash = fakeDashboard();
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: true, dashboard: dash });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preview).toBe(true);
    expect(res.body.data.html).toContain('OnCalls — ndb');
    expect(res.body.data.html).toContain('Heroes');
    expect(res.body.data.subject).toMatch(/\[OnCalls 7d\]/);
    expect(sendEmailDirect).not.toHaveBeenCalled();
    expect(getDashboard).not.toHaveBeenCalled();
  });

  test('previewOnly false → sent:true messageId', async () => {
    const dash = fakeDashboard();
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', previewOnly: false, dashboard: dash });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.messageId).toBe('<msg-1>');
    expect(res.body.data.preview).toBe(false);
    expect(sendEmailDirect).toHaveBeenCalledTimes(1);
    const args = sendEmailDirect.mock.calls[0][0];
    expect(args.html).toContain('OnCalls');
    expect(args.subject).toMatch(/\[OnCalls 7d\]/);
  });

  test('previewOnly missing (falsy) → treated as send', async () => {
    const dash = fakeDashboard();
    const res = await request(app)
      .post('/api/jira/oncalls/report')
      .set(AUTH)
      .send({ teamId: 'ndb', timeframe: '7d', dashboard: dash });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(sendEmailDirect).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/jira/oncalls/report — existing behavioral coverage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('when dashboard missing, server re-fetches via getDashboard', async () => {
    getDashboard.mockResolvedValue(fakeDashboard());
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'ndb', timeframe: '7d', previewOnly: true });
    expect(res.status).toBe(200);
    expect(getDashboard).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'ndb', timeframe: '7d' }));
    expect(res.body.data.html).toContain('OnCalls');
  });

  test('notConfigured dashboard renders banner', async () => {
    const dash = fakeDashboard({ notConfigured: true, hero: { open: { count: 0 }, agedOpen: { count: 0 } } });
    const res = await request(app).post('/api/jira/oncalls/report').set(AUTH).send({ teamId: 'unknown-team', timeframe: '7d', previewOnly: true, dashboard: dash });
    expect(res.status).toBe(200);
    expect(res.body.data.html).toContain('OnCalls not configured for team unknown-team');
    expect(res.body.data.html).toContain('Add OnCalls KPI in Admin');
  });
});
