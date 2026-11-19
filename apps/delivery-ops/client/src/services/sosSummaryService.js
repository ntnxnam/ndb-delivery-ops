import { authenticatedGet, authenticatedPost, authenticatedPut } from '../shared/services/apiService';

export async function fetchGateData(release, opts) {
  const res = await authenticatedGet('/api/release-dataset/gates', { release }, opts);
  if (res.data?.success && res.data?.data) return res.data.data;
  return null;
}

export async function fetchReleaseDates(opts) {
  const res = await authenticatedGet('/api/config/release-dates', undefined, opts);
  return res.data?.releases || {};
}

export async function generateExecSummary(item, ganttConfig, release, opts) {
  const res = await authenticatedPost('/api/ai/exec-summary', { item, ganttConfig, breakdownData: null, release, releaseContext: null }, opts);
  return res.data?.summary || '';
}

export async function pushExecSummary(key, summary, opts) {
  await authenticatedPut(`/api/ai/exec-summary/${key}`, { summary }, opts);
}

export function gatesResponseToGanttConfig(gatesData) {
  if (!gatesData?.gates?.length) return null;
  const config = {};
  const counters = {};
  for (const gate of gatesData.gates) {
    if (!gate.iso) continue;
    const kind = (gate.kind || '').toUpperCase();
    let prefix;
    if (kind === 'CG') prefix = 'commitGate';
    else if (kind === 'PG') prefix = 'promotionGate';
    else if (kind === 'GA') prefix = 'ga';
    else if (kind === 'CC' || kind === 'CCM') prefix = 'ccm';
    else if (kind === 'EC') { config.ecDate = gate.iso; continue; } else continue;
    counters[prefix] = (counters[prefix] || 0) + 1;
    const key = `${prefix}${counters[prefix]}`;
    config[key] = { date: gate.iso, style: gate.style || 'solid', label: gate.label || kind };
  }
  return Object.keys(config).length > 0 ? config : null;
}
