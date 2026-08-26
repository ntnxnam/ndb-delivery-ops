/**
 * Sprint health rates — typed ESM surface for getSprintMetrics.
 * Implementation matches shared/src/domain/sprintMetrics.cjs (CJS SoT for Express).
 */

export interface SprintMetricsInput {
  totalInSprint: number;
  addedAfterStart: number;
  inProgress: number;
  pendingQA: number;
  completedInSprint: number;
  removedFromSprint?: number;
}

export interface SprintMetrics {
  totalInSprint: number;
  addedAfterStart: number;
  removedFromSprint: number;
  open: number;
  inProgress: number;
  pendingQA: number;
  completedInSprint: number;
  completionRate: number;
  pendingQARate: number;
  carryoverRate: number;
  scopeCreepRate: number;
}

export function getSprintMetrics({
  totalInSprint,
  addedAfterStart,
  inProgress,
  pendingQA,
  completedInSprint,
  removedFromSprint = 0,
}: SprintMetricsInput): SprintMetrics {
  const completionRate = totalInSprint > 0 ? Math.round((completedInSprint / totalInSprint) * 100) : 0;
  const pendingQARate = totalInSprint > 0 ? Math.round((pendingQA / totalInSprint) * 100) : 0;
  const carryoverRate = totalInSprint > 0 ? Math.round(((pendingQA + inProgress) / totalInSprint) * 100) : 0;
  const plannedIssues = totalInSprint - addedAfterStart;
  const scopeCreepRate = plannedIssues > 0 ? Math.round((addedAfterStart / plannedIssues) * 100) : 0;
  return {
    totalInSprint,
    addedAfterStart,
    removedFromSprint,
    open: totalInSprint - inProgress - pendingQA - completedInSprint,
    inProgress,
    pendingQA,
    completedInSprint,
    completionRate,
    pendingQARate,
    carryoverRate,
    scopeCreepRate,
  };
}
