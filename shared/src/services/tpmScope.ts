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
