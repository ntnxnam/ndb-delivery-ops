import { formatters } from '../../shared/utils/formatters';

export function formatDate(iso) {
  if (!iso) return '—';
  return formatters.date(iso) || '—';
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = formatters.date(iso) || '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

export function latestFetchedAt(releases, releaseMeta) {
  let latest = null;
  for (const rel of releases || []) {
    const iso = releaseMeta?.[rel]?.fetchedAtIso;
    if (!iso) continue;
    if (!latest || iso > latest) latest = iso;
  }
  return latest;
}

export function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function releaseTypeLabel(name) {
  const dots = (name.match(/\./g) || []).length;
  if (/-EA|-RC|-BETA|-ALPHA/i.test(name)) return 'Pre-rel';
  if (dots === 1) return 'Minor';
  if (dots === 2) return 'Maint.';
  if (dots >= 3) return 'Patch';
  return null;
}
