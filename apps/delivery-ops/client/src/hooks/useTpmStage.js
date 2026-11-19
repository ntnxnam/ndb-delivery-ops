import { useState, useEffect, useCallback } from 'react';
import { getApiBase, getAuthHeaders } from '../shared/services/apiService';

/**
 * Derive stage client-side from gateDates map + today, mirroring server tpmStageService.
 * Also fetches gateDates via /api/tpm/pulse when not provided.
 */

function classifyGate(key) {
  const k = String(key || '').toLowerCase();
  if (!k) return null;
  if (k.includes('ccm') || k.includes('codecomplete') || (k.includes('code') && !k.includes('promotion') && !k.includes('commit'))) return 'code';
  if (k.includes('commit')) return 'commit';
  if (k.includes('promotion')) return 'promotion';
  if (/^ga\d*/.test(k) || k.includes('generalavailability') || k === 'ga' || k.startsWith('ga')) return 'ga';
  return null;
}

function gateToIso(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const s = val.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (typeof val === 'object' && typeof val.date === 'string') {
    const s = val.date.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return null;
}

function collectThresholds(gateMap) {
  if (!gateMap || typeof gateMap !== 'object') return { code: null, promotion: null, ga: null, allDates: [] };
  const skip = new Set(['devDRIs', 'qaDRIs', 'dateHistory', 'notes', 'releaseNotes', 'info', '_jira', 'jiraMeta', '_source', '_syncedAt', 'ecDate', 'preEc', 'preCommit']);
  const allDates = [];
  for (const [key, val] of Object.entries(gateMap)) {
    if (skip.has(key) || key.startsWith('conceptCommit')) continue;
    const iso = gateToIso(val);
    if (!iso) continue;
    const bucket = classifyGate(key);
    if (!bucket) continue;
    allDates.push({ key, date: iso, bucket });
  }
  allDates.sort((a, b) => a.date.localeCompare(b.date));
  const earliest = (bucket) => {
    const f = allDates.filter((d) => d.bucket === bucket).sort((a, b) => a.date.localeCompare(b.date));
    return f.length ? f[0].date : null;
  };
  return { code: earliest('code'), promotion: earliest('promotion'), ga: earliest('ga'), allDates };
}

function deriveStage(releaseVersion, todayIso, gateDatesMap) {
  const gateMap = gateDatesMap && gateDatesMap[releaseVersion] ? gateDatesMap[releaseVersion] : null;
  if (!todayIso || !gateMap) return { stage: 'overall', reason: 'No gate dates — fallback to overall', nextGate: null, gateDatesForRelease: gateMap || {} };
  const { code, promotion, ga, allDates } = collectThresholds(gateMap);
  if (!allDates.length) return { stage: 'overall', reason: 'No gates — fallback to overall', nextGate: null, gateDatesForRelease: gateMap };
  const upcoming = allDates.filter((d) => d.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date));
  let nextGate = null;
  if (upcoming.length) {
    const g = upcoming[0];
    const raw = gateMap[g.key];
    const label = raw && typeof raw === 'object' && raw.label ? raw.label : g.key;
    nextGate = { key: g.key, date: g.date, label };
  }
  if (code && todayIso < code) return { stage: 'execution', reason: `today ${todayIso} < codeComplete ${code}`, nextGate, gateDatesForRelease: gateMap };
  if (code && promotion && todayIso >= code && todayIso < promotion) return { stage: 'release', reason: `today ${todayIso} in [${code}, ${promotion})`, nextGate, gateDatesForRelease: gateMap };
  if (code && !promotion && ga && todayIso >= code && todayIso < ga) return { stage: 'release', reason: `today ${todayIso} in [${code}, ${ga})`, nextGate, gateDatesForRelease: gateMap };
  if (code && !promotion && !ga && todayIso >= code) return { stage: 'release', reason: `today ${todayIso} >= ${code}`, nextGate, gateDatesForRelease: gateMap };
  if (!code && promotion && todayIso < promotion) return { stage: 'execution', reason: `today ${todayIso} < promotion ${promotion}`, nextGate, gateDatesForRelease: gateMap };
  if (ga && todayIso >= ga) return { stage: 'postRelease', reason: `today ${todayIso} >= ga ${ga}`, nextGate, gateDatesForRelease: gateMap };
  if (promotion && todayIso >= promotion) {
    if (ga && todayIso < ga) return { stage: 'release', reason: `today ${todayIso} in [promotion ${promotion}, ga ${ga})`, nextGate, gateDatesForRelease: gateMap };
    if (!ga) return { stage: 'overall', reason: `today ${todayIso} >= promotion ${promotion} but no GA — overall`, nextGate, gateDatesForRelease: gateMap };
  }
  return { stage: 'overall', reason: `fallback to overall`, nextGate, gateDatesForRelease: gateMap };
}

/**
 * Hook: given teamId + releaseVersion, fetch gateDates and compute stage.
 * @param {string} teamId
 * @param {string} releaseVersion
 * @param {string} [todayOverride] - YYYY-MM-DD for testing
 */
export default function useTpmStage(teamId, releaseVersion, todayOverride) {
  const [gateDatesMap, setGateDatesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const todayIso = todayOverride ? String(todayOverride).slice(0, 10) : new Date().toISOString().slice(0, 10);

  const fetchGates = useCallback(async () => {
    setLoading(true);
    try {
      const apiBase = getApiBase();
      const { headers } = getAuthHeaders();
      const url = `${apiBase}/api/tpm/pulse?teamId=${encodeURIComponent(teamId || 'ndb')}`;
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...headers } });
      if (!res.ok) throw new Error(`pulse ${res.status}`);
      const data = await res.json();
      setGateDatesMap(data.gateDates || {});
    } catch {
      // keep empty map — stage will fallback to overall
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { fetchGates(); }, [fetchGates]);

  const derived = releaseVersion ? deriveStage(releaseVersion, todayIso, gateDatesMap) : { stage: 'overall', reason: 'No release selected', nextGate: null, gateDatesForRelease: {} };

  return { stage: derived.stage, reason: derived.reason, nextGate: derived.nextGate, gateDatesForRelease: derived.gateDatesForRelease, gateDatesMap, loading, refresh: fetchGates };
}

export { deriveStage };
