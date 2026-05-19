/**
 * Audience IDs — eleven product-agnostic audiences.
 *
 * Per D6 (Role lens is a presenter, not a filter), audience drives how
 * data is rendered, not which data is shown. Canonical definitions live in
 * `~/.cursor/context/audience.md`.
 *
 * Cross-references:
 *   - audience.md — canonical definitions
 *   - .cursor/rules/persona-aware-output.mdc
 *   - DECISIONS.md → D6
 */

export type AudienceId =
  | 'vp'
  | 'director'
  | 'portfolio_mgr'
  | 'tpm'
  | 'rm'
  | 'feat'
  | 'team_lead'
  | 'team_mgr'
  | 'ic'
  | 'qa_lead'
  | 'architect';

export const AUDIENCE_IDS: ReadonlyArray<AudienceId> = [
  'vp',
  'director',
  'portfolio_mgr',
  'tpm',
  'rm',
  'feat',
  'team_lead',
  'team_mgr',
  'ic',
  'qa_lead',
  'architect',
];

/**
 * Densities map to the tone matrix in audience.md. Each audience has a
 * density bucket that drives table size, bullet length, chart-vs-prose.
 */
export type AudienceDensity = 'executive' | 'manager' | 'engineer' | 'firehose';

export const DENSITY_BY_AUDIENCE: Record<AudienceId, AudienceDensity> = {
  vp: 'executive',
  director: 'executive',
  portfolio_mgr: 'firehose',
  tpm: 'manager',
  rm: 'manager',
  feat: 'manager',
  team_lead: 'manager',
  team_mgr: 'manager',
  qa_lead: 'manager',
  architect: 'manager',
  ic: 'engineer',
};

/**
 * Citation policy per audience. Per D10, every audience requires
 * citations on substantive claims, but density of inline citation
 * differs.
 */
export type CitationDensity = 'always-inline' | 'counts-only' | 'appendix' | 'optional';

export const CITATION_BY_AUDIENCE: Record<AudienceId, CitationDensity> = {
  vp: 'counts-only',
  director: 'counts-only',
  portfolio_mgr: 'optional',
  tpm: 'always-inline',
  rm: 'always-inline',
  feat: 'always-inline',
  team_lead: 'always-inline',
  team_mgr: 'always-inline',
  qa_lead: 'always-inline',
  architect: 'always-inline',
  ic: 'always-inline',
};
