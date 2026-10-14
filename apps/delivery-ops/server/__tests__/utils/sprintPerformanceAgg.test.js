const { agg } = require('../../utils/sprintPerformanceMetrics');

const cfg = {
  qaVerificationIssueTypes: ['Bug', 'Improvement'],
  qaVerificationRatio: 0.33,
};

/** Minimal row for agg — statusAtClose mirrors Sprint Report close status. */
function row(partial) {
  return {
    added: false,
    removed: false,
    done: false,
    carried: false,
    doneElsewhere: false,
    devDone: false,
    testDone: false,
    qaVerified: false,
    pendingQA: false,
    unresolvedNow: false,
    isTest: false,
    sp: 0,
    key: 'ERA-1',
    issuetype: 'Task',
    statusAtClose: 'Open',
    ...partial,
  };
}

describe('agg delivery-trend rates', () => {
  test('planned-only + type-matched denominators for three completion %', () => {
    const rows = [
      row({ key: 'A', issuetype: 'Bug', statusAtClose: 'Resolved' }),
      row({ key: 'B', issuetype: 'Bug', statusAtClose: 'Closed', done: true, qaVerified: true }),
      row({ key: 'C', issuetype: 'Improvement', statusAtClose: 'Open' }),
      row({ key: 'D', issuetype: 'Task', statusAtClose: 'Closed', done: true }),
      row({ key: 'E', issuetype: 'Test', statusAtClose: 'Closed', done: true, testDone: true }),
      row({ key: 'F', issuetype: 'Task', statusAtClose: 'Open' }),
      // Mid-sprint add: counted in Added bar, excluded from planned rates
      row({ key: 'G', issuetype: 'Bug', statusAtClose: 'Resolved', added: true }),
      row({ key: 'H', issuetype: 'Task', statusAtClose: 'Closed', added: true, done: true }),
    ];
    const a = agg(rows, cfg);
    expect(a.planned).toBe(6); // A–F
    expect(a.added).toBe(2);
    expect(a.sayBugImp).toBe(3); // A, B, C
    expect(a.sayOther).toBe(3); // D, E, F
    expect(a.resolvedBugImp).toBe(1); // A only (G excluded — added)
    expect(a.closedBugImp).toBe(1); // B
    expect(a.closedOther).toBe(2); // D, E
    expect(a.pctResolvedBugImp).toBe(33); // 1/3
    expect(a.pctClosedBugImp).toBe(33); // 1/3
    expect(a.pctClosedOther).toBe(67); // 2/3
    expect(a.closedTest).toBe(1); // E
    expect(a.closedOtherNonTest).toBe(1); // D
    // BI Res(1) + BI Clo(1) + Test/other Clo(2) = 4 / planned 6
    expect(a.deliveryProgressPlanned).toBe(4);
    expect(a.pctDeliveryProgress).toBe(67);
  });

  test('empty slot yields null percentages', () => {
    const a = agg([], cfg);
    expect(a.planned).toBe(0);
    expect(a.pctResolvedBugImp).toBeNull();
    expect(a.pctClosedBugImp).toBeNull();
    expect(a.pctClosedOther).toBeNull();
    expect(a.pctDeliveryProgress).toBeNull();
  });
});
