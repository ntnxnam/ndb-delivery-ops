/**
 * Plain-language captions for the Show filter.
 * Partner type (*-ew) is a separate control — never train-dep / asks.
 */

export const SHOW_OPTIONS = [
  { value: 'everything', label: 'Everything for this release' },
  { value: 'i_wait', label: "I'm waiting on them" },
  { value: 'they_wait', label: "They're waiting on me" },
  { value: 'train_labels', label: 'Our labeled asks (train labels)' },
  { value: 'wishlist', label: 'Wishlist / pre-commit' },
  { value: 'companion', label: 'Work under our epics' },
];

/** Short caption under the Show control — one line, no glossary. */
export const SHOW_CAPTIONS = {
  everything: 'Partnership links, work under our epics, our train-label asks, and wishlist.',
  i_wait: 'Partnership only — tickets my work is blocked by (JIRA is blocked by / blocks).',
  they_wait: 'Partnership only — tickets waiting on my work.',
  train_labels:
    'Labels on our tickets (ndb-*-dependency / -asks) — not Partner type (*-ew).',
  wishlist: 'Our wishlist items and linked partner work — get Commit or add real links.',
  companion: 'Their tickets under our epics / companion roots (Parent Link), not a blocks link.',
};

export const PAGE_OUTCOME =
  'Pick Show for what you want to chase. Partner type narrows by *-ew only (not train labels).';

/** @deprecated use SHOW_CAPTIONS — kept for any stray imports */
export const MODE_HELP = {
  all: { title: 'Everything', shows: SHOW_CAPTIONS.everything, action: '' },
  partnership: { title: "I'm waiting on them", shows: SHOW_CAPTIONS.i_wait, action: '' },
  companion: { title: 'Work under our epics', shows: SHOW_CAPTIONS.companion, action: '' },
  labels: { title: 'Train labels', shows: SHOW_CAPTIONS.train_labels, action: '' },
  wishlist: { title: 'Wishlist', shows: SHOW_CAPTIONS.wishlist, action: '' },
};
