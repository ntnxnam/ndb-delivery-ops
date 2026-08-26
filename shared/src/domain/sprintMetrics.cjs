/**
 * Sprint health rates — shared SoT (Wave 3 / D41).
 * Pure. No JIRA I/O. CJS so Express sprintService can require() it.
 */

function getSprintMetrics({
  totalInSprint,
  addedAfterStart,
  inProgress,
  pendingQA,
  completedInSprint,
  removedFromSprint = 0,
}) {
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

module.exports = { getSprintMetrics };
