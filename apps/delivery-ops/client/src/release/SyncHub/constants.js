export const BUCKET_KEYS = [
  'top_level_projects',
  'epics_of_projects',
  'work_toward_project',
  'standalone_epics',
  'work_toward_standalone_epic',
  'direct_tickets',
];

export const BUCKET_LABELS = {
  top_level_projects:          'Top-Level Projects',
  epics_of_projects:           'Epics of Projects',
  work_toward_project:         'Work Toward Projects',
  standalone_epics:            'Standalone Epics',
  work_toward_standalone_epic: 'Work Toward Epics',
  direct_tickets:              'Direct Tickets',
};

export const BUCKET_SHORT = {
  top_level_projects:          'Projects',
  epics_of_projects:           'Epics',
  work_toward_project:         'Work',
  standalone_epics:            'SA Epics',
  work_toward_standalone_epic: 'SA Work',
  direct_tickets:              'Direct',
};

export function cellSyncKey(release, bucketName) {
  return `${release}::${bucketName}`;
}

export function releaseFromCellKey(key) {
  if (!key) return null;
  const idx = key.indexOf('::');
  return idx === -1 ? key : key.slice(0, idx);
}
