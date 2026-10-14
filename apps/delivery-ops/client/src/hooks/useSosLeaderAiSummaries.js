/**
 * useSosLeaderAiSummaries — Overall + Leader×Release GenAI briefs for SoS by Leader.
 * Client-assembled packets; no JIRA on the server. Fetch-only hook.
 */

import { useState, useCallback, useRef } from 'react';
import { authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';
import { classifyRiskWord } from './useSosTierSummary';

const STALE_DAYS = 14;

function daysOld(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function ragCountsFromItems(items) {
  const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
  (items || []).forEach((i) => {
    counts[classifyRiskWord(i.customfield_23560)] += 1;
  });
  return counts;
}

function categoryCountsFromProjectStatus(ps) {
  if (!ps) return { feat: 0, standalone: 0, direct: 0 };
  const feat = (ps.projects || []).length;
  const standalone = (ps.standaloneEpics || []).length;
  const groups = ps.standaloneTickets?.issueTypeGroups || [];
  const direct = groups.reduce((s, g) => s + (Number(g.total) || 0), 0);
  return { feat, standalone, direct };
}

function gateDatesFromGateData(gateData) {
  const gates = gateData?.gates || [];
  const find = (kind) => {
    const g = gates.find((x) => String(x.kind || '').toUpperCase() === kind);
    return g?.iso || null;
  };
  return { cgDate: find('CG'), pgDate: find('PG'), gaDate: find('GA') };
}

function itemHygiene(items) {
  let staleCount = 0;
  let notSetCount = 0;
  (items || []).forEach((i) => {
    const age = daysOld(i?.customfield_45660);
    if (age === null || age >= STALE_DAYS) staleCount += 1;
    if (classifyRiskWord(i.customfield_23560) === 'NotSet') notSetCount += 1;
  });
  return { staleCount, notSetCount };
}

function compactItems(items) {
  return (items || []).slice(0, 40).map((i) => ({
    key: i.key,
    summary: i.summary || i.fields?.summary || '',
    rag: classifyRiskWord(i.customfield_23560),
    status: i.status || i.fields?.status?.name || '',
  }));
}

export function useSosLeaderAiSummaries() {
  const [overall, setOverall] = useState({ state: 'idle', summary: null, error: null, generatedAt: null });
  const [byKey, setByKey] = useState({});
  const startedRef = useRef(new Set());
  const runningRef = useRef(false);
  const overallStartedRef = useRef(false);

  const reset = useCallback(() => {
    startedRef.current.clear();
    runningRef.current = false;
    overallStartedRef.current = false;
    setOverall({ state: 'idle', summary: null, error: null, generatedAt: null });
    setByKey({});
  }, []);

  const generateOverall = useCallback(async ({
    activeVersions,
    byVersion,
    gateDataMap,
    projectStatusByRelease,
  }) => {
    if (overallStartedRef.current) return;
    overallStartedRef.current = true;
    setOverall({ state: 'loading', summary: null, error: null, generatedAt: null });

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    try {
      const validKeys = [];
      const seen = new Set();
      let staleCount = 0;
      let notSetCount = 0;
      const releases = (activeVersions || []).map((version) => {
        const items = byVersion[version] || [];
        items.forEach((i) => {
          if (i?.key && !seen.has(i.key)) {
            seen.add(i.key);
            validKeys.push(i.key);
          }
        });
        const hy = itemHygiene(items);
        staleCount += hy.staleCount;
        notSetCount += hy.notSetCount;
        return {
          version,
          itemCount: items.length,
          ragCounts: ragCountsFromItems(items),
          categoryCounts: categoryCountsFromProjectStatus(projectStatusByRelease?.[version]),
          gateDates: gateDatesFromGateData(gateDataMap?.[version]),
        };
      });

      const resp = await authenticatedPost(
        '/api/ai/sos-overall-summary',
        { releases, validKeys: validKeys.slice(0, 80), staleCount, notSetCount },
        { jiraToken, username }
      );
      setOverall({
        state: 'done',
        summary: resp.data?.summary || '',
        error: null,
        generatedAt: resp.data?.generatedAt || new Date().toISOString(),
      });
    } catch (err) {
      overallStartedRef.current = false;
      setOverall({
        state: 'error',
        summary: null,
        error: getUserFacingMessage(err, {
          context: 'sos-overall-summary',
          fallback: err.response?.data?.error || err.message || 'Overall summary failed',
        }),
        generatedAt: null,
      });
    }
  }, []);

  const generateLeaderRelease = useCallback(async ({
    summaryKey,
    leaderId,
    leaderName,
    release,
    items,
    gateData,
  }) => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setByKey((prev) => ({
      ...prev,
      [summaryKey]: { state: 'loading', summary: null, error: null, generatedAt: null },
    }));

    try {
      const hy = itemHygiene(items);
      const compact = compactItems(items);
      const resp = await authenticatedPost(
        '/api/ai/sos-leader-release-summary',
        {
          release,
          leaderId,
          leaderName,
          itemCount: (items || []).length,
          ragCounts: ragCountsFromItems(items),
          gateDates: gateDatesFromGateData(gateData),
          staleCount: hy.staleCount,
          notSetCount: hy.notSetCount,
          items: compact,
          validKeys: compact.map((i) => i.key),
        },
        { jiraToken, username }
      );
      setByKey((prev) => ({
        ...prev,
        [summaryKey]: {
          state: 'done',
          summary: resp.data?.summary || '',
          error: null,
          generatedAt: resp.data?.generatedAt || new Date().toISOString(),
        },
      }));
    } catch (err) {
      startedRef.current.delete(summaryKey);
      setByKey((prev) => ({
        ...prev,
        [summaryKey]: {
          state: 'error',
          summary: null,
          error: getUserFacingMessage(err, {
            context: 'sos-leader-release-summary',
            fallback: err.response?.data?.error || err.message || 'Leader summary failed',
          }),
          generatedAt: null,
        },
      }));
    }
  }, []);

  /**
   * Queue leader×release jobs one at a time. Safe against mid-flight dep churn
   * via started Set + running flag (caller should pass a stable job list).
   */
  const runLeaderReleaseQueue = useCallback(async (jobs) => {
    if (runningRef.current) return;
    const pending = (jobs || []).filter((j) => j?.summaryKey && !startedRef.current.has(j.summaryKey));
    if (!pending.length) return;

    runningRef.current = true;
    try {
      for (const job of pending) {
        startedRef.current.add(job.summaryKey);
        await generateLeaderRelease(job);
      }
    } finally {
      runningRef.current = false;
    }
  }, [generateLeaderRelease]);

  const retryLeaderRelease = useCallback((job) => {
    if (!job?.summaryKey) return;
    startedRef.current.delete(job.summaryKey);
    return generateLeaderRelease(job);
  }, [generateLeaderRelease]);

  const retryOverall = useCallback((args) => {
    overallStartedRef.current = false;
    return generateOverall(args);
  }, [generateOverall]);

  return {
    overall,
    byKey,
    reset,
    generateOverall,
    retryOverall,
    runLeaderReleaseQueue,
    retryLeaderRelease,
    categoryCountsFromProjectStatus,
    ragCountsFromItems,
  };
}
