/**
 * TPM scope helpers — product-agnostic (D1), one place for scope → JQL.
 * Fetch weaves call these; report weave reuses them for fan-out.
 */
import type { TpmScope } from '../types/tpm.js';

export function scopeLabel(scope: TpmScope): string {
  switch (scope.kind) {
    case 'me': return `${scope.teamId}:${scope.principal}`;
    case 'release': return `${scope.releaseVersion} (${scope.teamId})`;
    case 'team': return scope.teamId;
    case 'org': return scope.orgId;
  }
}

export function isReleaseScope(scope: TpmScope): boolean {
  return scope.kind === 'release';
}

/** Resolve releaseVersion from any scope that carries one, or null. */
export function scopeReleaseVersion(scope: TpmScope): string | null {
  return scope.kind === 'release' ? scope.releaseVersion : null;
}

/** Resolve teamId from any scope (first team for org). */
export function scopeTeamId(scope: TpmScope): string {
  if (scope.kind === 'org') return scope.teamIds[0] ?? scope.orgId;
  return scope.teamId;
}

export function validateScope(scope: TpmScope): string | null {
  if (!scope || typeof scope.kind !== 'string') return 'scope.kind missing';
  if (scope.kind === 'me' && (!scope.teamId || !scope.principal)) return 'me scope requires teamId and principal';
  if (scope.kind === 'release' && (!scope.releaseVersion || !scope.teamId)) return 'release scope requires releaseVersion and teamId';
  if (scope.kind === 'team' && !scope.teamId) return 'team scope requires teamId';
  if (scope.kind === 'org' && (!scope.orgId || !Array.isArray(scope.teamIds))) return 'org scope requires orgId and teamIds';
  return null;
}
