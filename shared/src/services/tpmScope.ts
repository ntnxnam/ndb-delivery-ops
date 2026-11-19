/**
 * tpmScope — helpers for TpmScope (D1 product-agnostic, D10 citation-first).
 */

import type { TpmScope } from '../types/tpm.js';

export function scopeLabel(scope: TpmScope): string {
  if (scope.kind === 'release' && scope.releaseVersion) return scope.releaseVersion;
  if (scope.kind === 'sprint' && scope.sprintId != null) return `sprint:${String(scope.sprintId)}`;
  if (scope.kind === 'team' && scope.teamId) return `team:${scope.teamId}`;
  if (scope.kind === 'overall') return scope.teamId ? `overall:${scope.teamId}` : 'overall';
  return scope.kind;
}

export function isReleaseScope(scope: TpmScope): boolean {
  return scope.kind === 'release' && Boolean(scope.releaseVersion);
}

export function validateScope(scope: TpmScope): string | null {
  if (!scope.kind) return 'scope.kind is required';
  if (scope.kind === 'release' && !scope.releaseVersion) return 'releaseVersion required for release scope';
  return null;
}
