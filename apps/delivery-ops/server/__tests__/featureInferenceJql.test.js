/**
 * Every inference claim must carry a JQL that matches the exact keys behind the count.
 * Loads shared dist directly (bypasses Jest CJS stub for @portfolio-delivery-ops/shared).
 */
const path = require('path');
const { pathToFileURL } = require('url');

const sharedRoot = path.resolve(__dirname, '../../../../shared');

describe('feature inference JQL authenticity', () => {
  let keysToJql;
  let evaluateKickoff;
  let inferFeatureConfidence;
  let computeFixVersionHygiene;

  beforeAll(async () => {
    const enrichment = await import(
      pathToFileURL(path.join(sharedRoot, 'dist/services/featureEnrichmentService.js')).href
    );
    const dashboard = await import(
      pathToFileURL(path.join(sharedRoot, 'dist/services/featureDashboardService.js')).href
    );
    keysToJql = enrichment.keysToJql;
    evaluateKickoff = enrichment.evaluateKickoff;
    inferFeatureConfidence = enrichment.inferFeatureConfidence;
    computeFixVersionHygiene = dashboard.computeFixVersionHygiene;
  });

  test('keysToJql builds exact key filters', () => {
    expect(keysToJql([])).toBe('');
    expect(keysToJql(['ERA-1'])).toBe('key = ERA-1');
    expect(keysToJql(['ERA-1', 'ERA-2'])).toBe('key in (ERA-1,ERA-2)');
  });

  test('drivers for real start / kickoff / coding / hygiene include verifiable JQL', () => {
    const timing = {
      plannedStart: '2026-05-14',
      realStart: '2026-04-01',
      realStartKey: 'NDBECO-149',
      deltaDaysVsEc: -43,
    };
    const kickoff = evaluateKickoff({
      epic: {
        key: 'ERA-KO',
        summary: 'Kick-off',
        issueType: 'Epic',
        status: 'Closed',
        created: '2026-01-01',
        resolved: '2026-08-11',
        updated: null,
        assignee: null,
        priority: null,
        labels: [],
        epicLink: null,
      },
      children: [
        {
          key: 'ERA-K1',
          summary: 'ko child',
          issueType: 'Task',
          status: 'Closed',
          created: '2026-01-01',
          resolved: '2026-08-11',
          updated: null,
          assignee: null,
          priority: null,
          labels: [],
          epicLink: 'ERA-KO',
        },
      ],
      ecDate: '2026-05-14',
      featureKey: 'FEAT-19398',
    });
    expect(kickoff.status).toBe('done_late');
    expect(kickoff.jql).toBe(
      'issueFunction in issuesInEpics("key = ERA-KO") OR key = ERA-KO'
    );

    const openCoding = Array.from({ length: 7 }, (_, i) => ({
      key: `ERA-C${i + 1}`,
      summary: `coding ${i}`,
      issueType: 'Task',
      status: 'In Progress',
      created: '2026-01-01',
      resolved: null,
      updated: '2026-09-01',
      assignee: null,
      priority: null,
      labels: [],
      epicLink: null,
    }));
    const hygieneItems = Array.from({ length: 34 }, (_, i) => ({
      key: `ERA-H${i + 1}`,
      summary: 'mis-tagged',
      issueType: 'Bug',
      status: 'Closed',
      created: '2026-01-01',
      resolved: '2026-02-01',
      updated: null,
      assignee: null,
      priority: null,
      labels: [],
      epicLink: null,
      fixVersions: [],
    }));
    const hygiene = computeFixVersionHygiene(hygieneItems, 'NDB-2.12', 'scope-jql');
    expect(hygiene.wrongFixVersionCount).toBe(34);
    expect(hygiene.jql.startsWith('key in (')).toBe(true);
    expect(hygiene.jql.split(',').length).toBe(34);

    const inference = inferFeatureConfidence({
      timing,
      kickoff,
      workItems: [...openCoding, ...hygieneItems],
      gates: { ec: '2026-05-14', pg: '2026-07-01', ga: '2026-09-01' },
      hygieneWrongFixVersionCount: hygiene.wrongFixVersionCount,
      hygieneJql: hygiene.jql,
      workItemsScopeJql: 'scope-jql',
    });

    const byId = Object.fromEntries(inference.drivers.map((d) => [d.id, d]));
    expect(byId.started.jql).toBe('key = NDBECO-149');
    expect(byId.kickoff_done_late.jql).toContain('ERA-KO');
    expect(byId.coding_past_pg.text).toContain('7 coding items');
    expect(byId.coding_past_pg.jql).toBe(
      'key in (ERA-C1,ERA-C2,ERA-C3,ERA-C4,ERA-C5,ERA-C6,ERA-C7)'
    );
    expect(byId.fixversion_hygiene.text).toContain('34 work items');
    expect(byId.fixversion_hygiene.jql).toBe(hygiene.jql);
    expect(inference.codingByPg.open).toBe(7);
    expect(inference.codingByPg.jql).toContain('ERA-C1');
  });
});
