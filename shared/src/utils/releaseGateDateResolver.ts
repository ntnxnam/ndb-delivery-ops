/**
 * Release gate date resolver — DRY mirror of server/utils/releaseGateDateResolver.js
 * Shared must not import app JSON (D41); caller injects gateDates map.
 */
export interface GateDatesMap {
  [versionName: string]: Record<string, { date?: string; style?: string }>;
}

export function getGateGaDateFromMap(versionName: string, gateDates: GateDatesMap | null | undefined): string | null {
  if (!versionName || !gateDates) return null;
  const gates = gateDates[versionName];
  if (!gates || typeof gates !== 'object') return null;
  const gaEntries = Object.entries(gates)
    .filter(([k, v]) => k.toLowerCase().startsWith('ga') && v && typeof (v as { date?: string }).date === 'string')
    .map(([k, v]) => ({ key: k, date: String((v as { date: string }).date).trim(), style: (v as { style?: string }).style || 'solid' }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  if (gaEntries.length === 0) return null;
  const solid = gaEntries.filter((e) => e.style === 'solid').sort((a, b) => b.date.localeCompare(a.date));
  if (solid.length > 0) return solid[0].date;
  return gaEntries.sort((a, b) => b.date.localeCompare(a.date))[0].date;
}
