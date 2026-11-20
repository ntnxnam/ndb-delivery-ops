/**
 * Application-wide configuration and constants.
 * Single source of truth for defaults and storage keys.
 * @module config
 */

/** Default timeline start (YYYY-MM-DD). */
export const DEFAULT_START = '2026-04-01';

/** Default timeline end / viewport (YYYY-MM-DD). */
export const DEFAULT_END = '2026-12-15';

/** Default headcount (number of FTEs). */
export const DEFAULT_NUM_FTES = 85;

/** Default capacity per FTE in percent (e.g. 60 = 60% productivity). */
export const DEFAULT_CAPACITY_PCT = 60;

/** localStorage key for raw imported project data (all rows from CSV/XLSX/JSON). */
export const UPLOAD_STORAGE_KEY = 'ndb-projects-upload';

/** localStorage key for schedule-ready data (Committed-only, cleaned, resource-grouped). */
export const SCHEDULE_STORAGE_KEY = 'ndb-committed-schedule';

/** localStorage key for last-used schedule filters (commitment, priority, etc.). */
export const FILTERS_STORAGE_KEY = 'ndb-projects-filters';

/** localStorage key for user-overridden start dates (rowNumber → dateString). */
export const START_DATE_OVERRIDES_KEY = 'ndb-start-date-overrides';

/** localStorage key for "fund first" flags (rowNumber → true). */
export const FUND_FIRST_KEY = 'ndb-fund-first';

/** localStorage key for user-overridden completed % (rowNumber → number). */
export const COMPLETED_PCT_OVERRIDES_KEY = 'ndb-completed-pct-overrides';

/** localStorage key for user-overridden FTE / people count (rowNumber → number). */
export const FTE_OVERRIDES_KEY = 'ndb-fte-overrides';

/** localStorage key for user-overridden total person-months (rowNumber → number). */
export const DURATION_OVERRIDES_KEY = 'ndb-duration-overrides';

/** Default release name (product-agnostic, D1). */
export const DEFAULT_RELEASE_NAME = 'Release 1';
/** Release registry: array of { id, name, createdAt, updatedAt }. */
export const RELEASES_REGISTRY_KEY = 'ndb-releases-registry';
/** Active release id. */
export const ACTIVE_RELEASE_KEY = 'ndb-active-release';

/** Per-release storage keys that are namespaced as `${base}:${releaseId}`. */
export const SCOPED_STORAGE_KEYS = [
  UPLOAD_STORAGE_KEY,
  SCHEDULE_STORAGE_KEY,
  FILTERS_STORAGE_KEY,
  START_DATE_OVERRIDES_KEY,
  FUND_FIRST_KEY,
  COMPLETED_PCT_OVERRIDES_KEY,
  FTE_OVERRIDES_KEY,
  DURATION_OVERRIDES_KEY,
  'ndb-allocation-staff',
  'ndb-allocation-allocations',
  'ndb-allocation-headcount',
];

/** Enable debug logging when true. Set via query param ?debug=1 or build. */
export const DEBUG = typeof window !== 'undefined' && /[?&]debug=1/.test(window.location.search);

/** Min/max bounds for numeric inputs. */
export const NUM_FTES_MIN = 1;
export const NUM_FTES_MAX = 500;
export const CAPACITY_PCT_MIN = 0.1;
export const CAPACITY_PCT_MAX = 100;
