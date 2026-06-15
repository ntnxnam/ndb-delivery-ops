import { useMemo } from 'react';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';

/**
 * Lightweight gate-timeline loader for legacy pages that need the shared
 * release-gate chips without pulling all Release Brief state.
 */
export function useGateTimeline({ release, jiraToken, username }) {
  void jiraToken;
  void username;
  const {
    selectedRelease,
    gateTimeline,
    loadingGateTimeline,
    gateError,
    refreshGateTimeline,
  } = useSelectedRelease();

  return useMemo(() => {
    const effectiveRelease = release || selectedRelease;
    const gates = effectiveRelease === selectedRelease
      ? (Array.isArray(gateTimeline?.gates) ? gateTimeline.gates : [])
      : [];
    return {
      gates,
      loading: loadingGateTimeline,
      error: gateError,
      refresh: refreshGateTimeline,
    };
  }, [release, selectedRelease, gateTimeline, loadingGateTimeline, gateError, refreshGateTimeline]);
}
