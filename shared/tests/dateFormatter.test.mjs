import { normalizeDateStr, formatDate, formatDueDate } from '../dist/utils/dateFormatter.js';

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('PASS: ' + msg); }

// normalizeDateStr
assert(normalizeDateStr('2026-02-28') === '2026-02-28', 'normalize YYYY-MM-DD');
assert(normalizeDateStr('2026-02-28T14:30:00Z') === '2026-02-28', 'normalize ISO datetime with T');
assert(normalizeDateStr(null) === null, 'normalize null');
assert(normalizeDateStr(undefined) === null, 'normalize undefined');
assert(normalizeDateStr('') === null, 'normalize empty string');
assert(normalizeDateStr(42) === null, 'normalize non-string/Date number');
assert(normalizeDateStr(new Date('2026-02-28')) === '2026-02-28', 'normalize Date object');
assert(normalizeDateStr(new Date('invalid')) === null, 'normalize invalid Date object');
assert(normalizeDateStr('not-a-date') === null, 'normalize unparseable string');
assert(normalizeDateStr('2026-13-01') === null, 'normalize invalid month via fallback Invalid Date');

// formatDate
assert(formatDate('2026-02-28') === '28/Feb/2026', 'formatDate YYYY-MM-DD');
assert(formatDate('2026-02-28T14:30:00Z') === '28/Feb/2026', 'formatDate ISO datetime with T');
assert(formatDate(null) === 'Not Set', 'formatDate null -> Not Set');
assert(formatDate(undefined) === 'Not Set', 'formatDate undefined -> Not Set');
assert(formatDate('') === 'Not Set', 'formatDate empty -> Not Set');
assert(formatDate(new Date('2026-02-28')) === '28/Feb/2026', 'formatDate Date object');
assert(formatDate(new Date('invalid')) === null, 'formatDate invalid Date object -> null');
assert(formatDate('not-a-date') === null, 'formatDate unparseable string -> null');

// formatDueDate strict
assert(formatDueDate('2026-10-16') === '16/Oct/2026', 'formatDueDate ISO day');
assert(formatDueDate('2026-02-28') === '28/Feb/2026', 'formatDueDate another ISO day');
assert(formatDueDate('2026-10-16T05:00:00.000+0530') === '16/Oct/2026', 'formatDueDate ISO datetime slices to day');
assert(formatDueDate(null) === 'Not Set', 'formatDueDate null -> Not Set');
assert(formatDueDate(undefined) === 'Not Set', 'formatDueDate undefined -> Not Set');
assert(formatDueDate('') === 'Not Set', 'formatDueDate empty -> Not Set');
assert(formatDueDate('not-a-date') === 'Not Set', 'formatDueDate unparseable -> Not Set');
assert(formatDueDate('2026-13-01') === 'Not Set', 'formatDueDate invalid month 13 -> Not Set');
assert(formatDueDate('2026-00-15') === 'Not Set', 'formatDueDate month 00 -> Not Set');
assert(formatDueDate(new Date('2026-10-16')) === 'Not Set', 'formatDueDate Date object -> Not Set (strict string guard)');
assert(formatDueDate(42) === 'Not Set', 'formatDueDate number -> Not Set');

console.log('All dateFormatter tests PASSED');
