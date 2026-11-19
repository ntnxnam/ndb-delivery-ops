import {
import { getFieldId, getFieldValue } from '../../utils/jiraFields';
  buildEpicsFromFeatureDashboard,
  buildTotalEpicsJql,
  toStatusSenderEpicRow,
} from '../../components/EmailSender/buildEpicsFromFeatureDashboard';

describe('buildEpicsFromFeatureDashboard', () => {
  const canonical = [
    {
      key: 'FEAT-1',
      summary: 'Root feature',
      issueType: 'Feature',
      status: 'In Progress',
      resolution: null,
      assignee: 'Alice',
      qaContact: 'Bob QA',
      duedate: '2026-10-16',
      fixVersions: ['NDB-2.12'],
      parentLink: null,
    },
    {
      key: 'ERA-100',
      summary: 'Child epic',
      issueType: 'Epic',
      status: 'Open',
      resolution: null,
      assignee: 'Carol',
      qaContact: null,
      duedate: null,
      fixVersions: ['NDB-2.12', 'NDB-2.12.1'],
      parentLink: 'FEAT-1',
    },
    {
      key: 'ERA-200',
      summary: 'Orphan epic under root',
      issueType: 'Epic',
      status: 'To Do',
      resolution: 'Fixed',
      assignee: null,
      qaContact: 'Dana',
      duedate: '2026-11-01',
      fixVersions: [],
      parentLink: null,
    },
  ];

  test('toStatusSenderEpicRow uses Status Sender value shapes', () => {
    const row = toStatusSenderEpicRow(canonical[0], 'Feature');
    expect(row).toMatchObject({
      key: 'FEAT-1',
      issueType: 'Feature',
      summary: 'Root feature',
      status: 'In Progress',
      resolution: 'N/A',
      assignee: 'Alice',
      duedate: '16/Oct/2026',
      fixVersions: 'NDB-2.12',[getFieldId('qaContact')]: { name: 'QA Contact', value: 'Bob QA' },
    });
  });

  test('builds feature → child epics hierarchy from Feature Dashboard canonical', () => {
    const epics = buildEpicsFromFeatureDashboard(canonical, 'FEAT-1');
    expect(epics).toHaveLength(1);
    expect(epics[0].key).toBe('FEAT-1');
    expect(epics[0].qaContact.value).toBe('Bob QA');
    expect(epics[0].childEpics).toHaveLength(2);

    const linked = epics[0].childEpics.find((e) => e.key === 'ERA-100');
    expect(linked.fixVersions).toBe('NDB-2.12, NDB-2.12.1');
    expect(getFieldValue(linked, 'qaContact').value).toBe('Not Set');
    expect(linked.duedate).toBe('Not Set');

    const orphan = epics[0].childEpics.find((e) => e.key === 'ERA-200');
    expect(orphan.resolution).toBe('Fixed');
    expect(orphan.assignee).toBe('N/A');
    expect(orphan.duedate).toBe('01/Nov/2026');
  });

  test('X-FEAT root keeps only Features with Parent Link = root', () => {
    const level1 = [
      {
        key: 'FEAT-A',
        summary: 'Under X-FEAT',
        issueType: 'Feature',
        status: 'Open',
        parentLink: 'XFEAT-1',
        fixVersions: [],
      },
      {
        key: 'FEAT-B',
        summary: 'Unrelated',
        issueType: 'Feature',
        status: 'Open',
        parentLink: 'OTHER-1',
        fixVersions: [],
      },
      {
        key: 'ERA-9',
        summary: 'Epic under FEAT-A',
        issueType: 'Epic',
        status: 'Open',
        parentLink: 'FEAT-A',
        fixVersions: ['NDB-2.12'],
      },
    ];
    const epics = buildEpicsFromFeatureDashboard(level1, 'XFEAT-1', {
      rootIssueType: 'X-FEAT',
    });
    expect(epics).toHaveLength(1);
    expect(epics[0].key).toBe('FEAT-A');
    expect(epics[0].childEpics.map((e) => e.key)).toEqual(['ERA-9']);
    expect(buildTotalEpicsJql(epics)).toBe('key in (ERA-9)');
  });

  test('returns null for empty input', () => {
    expect(buildEpicsFromFeatureDashboard([], 'FEAT-1')).toBeNull();
    expect(buildEpicsFromFeatureDashboard(null, 'FEAT-1')).toBeNull();
  });
});
