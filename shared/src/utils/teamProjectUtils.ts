/**
 * Team project utilities (product-agnostic, D1).
 * All helpers are pure functions taking TeamConfig — no hardcoded product strings.
 */

import { TeamConfig } from '../types/teamConfig.js';

/** Check if a project key is a home project for this team. */
export function isHomeProject(projectKey: string, cfg: TeamConfig): boolean {
  return Array.isArray(cfg.homeProjects) && cfg.homeProjects.includes(projectKey);
}

/** Get home projects list for a team. */
export function getHomeProjects(cfg: TeamConfig): string[] {
  return cfg.homeProjects || [];
}

/** Get base filter string for a team (strips statusCategory!=Done for report use). */
export function getBaseFilter(cfg: TeamConfig): string {
  return cfg.baseFilter || '';
}

/** Get base filter with statusCategory!=Done stripped (for past-report use). */
export function getReportBaseFilter(cfg: TeamConfig): string {
  return cfg.baseFilter.replace(/\s*AND\s+statusCategory\s*!=\s*Done\b/gi, '').trim();
}

/** Get all release prefixes for a team (supports multiple release types, e.g. NCN). */
export function getReleasePrefixes(cfg: TeamConfig): string[] {
  return Array.isArray(cfg.releasePrefixes) ? cfg.releasePrefixes : [];
}

/** Get release regexes for a team. */
export function getReleaseRegexes(cfg: TeamConfig): RegExp[] {
  const prefixes = getReleasePrefixes(cfg);
  return prefixes.map(p => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d'));
}

/** Check if a string is a team release (matches any prefix). */
export function isTeamRelease(str: string, cfg: TeamConfig): boolean {
  const prefixes = getReleasePrefixes(cfg);
  return prefixes.some(p => str.startsWith(p));
}

/** Get label prefix for a team. */
export function getLabelPrefix(cfg: TeamConfig): string {
  return cfg.labelPrefix || '';
}

/** Get a labeled value (e.g., 'notPor' -> 'ndb-not-por'). */
export function getLabel(cfg: TeamConfig, key: string): string {
  const prefix = getLabelPrefix(cfg);
  const labelKey = cfg.labels?.[key];
  if (labelKey) return labelKey;
  // default: prefix + '-' + key
  return `${prefix}-${key}`;
}

/** Get notification emails for a team. */
export function getNotificationEmails(cfg: TeamConfig): TeamConfig['notificationEmails'] {
  return cfg.notificationEmails || { exec: '', techLeads: '', managers: '' };
}

/** Get TCMS config for a team. */
export function getTcmsConfig(cfg: TeamConfig): TeamConfig['tcms'] {
  return cfg.tcms || { projectSegment: cfg.projectKey, baseUrl: '' };
}

/** Get QA env URL for a team. */
export function getQaEnvUrl(cfg: TeamConfig, env: 'dev' | 'qa' | 'prod' = 'dev'): string {
  const qaEnv = cfg.qaEnv || {};
  if (env === 'dev') return qaEnv.devUrl || '';
  if (env === 'qa') return qaEnv.qaUrl || '';
  if (env === 'prod') return qaEnv.prodUrl || '';
  return '';
}

/** Get release prefix string (first prefix for backward compat). */
export function getReleasePrefix(cfg: TeamConfig): string {
  const prefixes = getReleasePrefixes(cfg);
  return prefixes[0] || '';
}

/** Strip release prefix from a version string. */
export function stripReleasePrefix(version: string, cfg: TeamConfig): string {
  const prefixes = getReleasePrefixes(cfg);
  for (const p of prefixes) {
    if (version.startsWith(p)) {
      return version.slice(p.length);
    }
  }
  return version;
}

/** Get branding display name. */
export function getBrandingDisplayName(cfg: TeamConfig): string {
  return cfg.branding?.displayName || cfg.displayName || cfg.name;
}

/** Get story points field for a team. */
export function getStoryPointsField(cfg: TeamConfig): string {
  return cfg.storyPointsField || 'customfield_10016';
}

/** Get default release for a team. */
export function getDefaultRelease(cfg: TeamConfig): string {
  return cfg.defaultRelease || '';
}

/** Get home projects joined as string. */
export function getHomeProjectsString(cfg: TeamConfig): string {
  return (cfg.homeProjects || []).join(', ');
}