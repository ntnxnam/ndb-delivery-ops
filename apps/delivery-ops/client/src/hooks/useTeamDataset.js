/**
 * useTeamDataset — thin consumer hook for TeamDatasetContext.
 *
 * Returns the full context value:
 *   {
 *     bundle, bundleMeta, isSyncing, syncProgress, syncError,
 *     triggerSync, refreshFromDisk, getTicketsForRelease, isReady
 *   }
 *
 * Must be used inside TeamDatasetProvider (already wired in App.js
 * directly inside TeamProvider). Returns a no-op fallback outside the
 * provider so that tests and storybook stories don't throw.
 */

import { useContext } from 'react';
import TeamDatasetContext from '../contexts/TeamDatasetContext';

const NOOP_CONTEXT = {
  bundle: null,
  bundleMeta: null,
  syncMeta: null,
  isSyncing: false,
  syncProgress: [],
  syncError: null,
  triggerSync: async () => {},
  refreshFromDisk: async () => {},
  resetCache: async () => {},
  isReady: false,
};

export function useTeamDataset() {
  const ctx = useContext(TeamDatasetContext);
  // Outside the provider (e.g. in unit tests with no wrapper) return the
  // no-op fallback rather than throwing, so individual component tests
  // don't need the full provider tree.
  return ctx ?? NOOP_CONTEXT;
}
