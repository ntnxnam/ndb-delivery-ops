import React, { useMemo } from 'react';

/**
 * Extract a stable string risk value from an item's risk indicator field.
 * The field can be a string, an object {value, color}, or null.
 */
function extractRisk(item) {
  const raw = item.customfield_23560;
  if (!raw) return 'Not Set';
  if (typeof raw === 'string') return raw.trim() || 'Not Set';
  if (typeof raw === 'object') return (raw.value || raw.name || 'Not Set').trim();
  return 'Not Set';
}

/**
 * Extract status string from item.
 */
function extractStatus(item) {
  const s = item.status;
  if (!s) return '';
  if (typeof s === 'string') return s.trim();
  if (typeof s === 'object') return (s.name || s.value || '').trim();
  return '';
}

/**
 * Extract assignee display name from item.
 */
function extractAssignee(item) {
  const a = item.assignee;
  if (!a) return 'Unassigned';
  if (typeof a === 'string') return a.trim() || 'Unassigned';
  if (typeof a === 'object') return (a.displayName || a.name || 'Unassigned').trim();
  return 'Unassigned';
}

/**
 * Extract assignee manager display name from item.
 */
function extractAssigneeManager(item) {
  const m = item.assigneeManager;
  if (!m) return 'No Manager';
  if (typeof m === 'string') return m.trim() || 'No Manager';
  if (typeof m === 'object') return (m.displayName || m.name || 'No Manager').trim();
  return 'No Manager';
}

/**
 * Returns true if the item's status update date is older than `days` days or missing.
 */
function isStale(item, days = 10) {
  let d = item.customfield_45660;
  if (!d) return true;
  if (typeof d === 'object' && !(d instanceof Date)) d = d.value || d.date || null;
  if (!d) return true;
  const date = new Date(d);
  if (isNaN(date.getTime())) return true;
  const diffMs = Date.now() - date.getTime();
  return diffMs > days * 24 * 60 * 60 * 1000;
}

/**
 * Apply the activeFilters object to a flat array of items.
 * Each filter is additive (AND logic).
 *
 * @param {Array} itemsArray - flat array of JIRA items
 * @param {Object} filters
 * @param {string} filters.risk    - '' = all, or specific value e.g. 'Red'
 * @param {string} filters.status  - '' = all, or specific status name
 * @param {string} filters.assignee - '' = all, or specific assignee name
 * @param {string} filters.assigneeManager - '' = all, or specific assignee manager name
 * @param {string} filters.staleness - '' = all, 'stale' = stale only, 'fresh' = not stale
 * @returns {Array}
 */
export function applyFilters(itemsArray, filters) {
  if (!itemsArray) return [];
  return itemsArray.filter(item => {
    if (filters.risk && filters.risk !== '') {
      const risk = extractRisk(item);
      if (filters.risk === 'Not Set') {
        if (risk !== 'Not Set') return false;
      } else {
        if (!risk.toLowerCase().includes(filters.risk.toLowerCase())) return false;
      }
    }
    if (filters.status && filters.status !== '') {
      if (extractStatus(item).toLowerCase() !== filters.status.toLowerCase()) return false;
    }
    if (filters.assignee && filters.assignee !== '') {
      if (extractAssignee(item) !== filters.assignee) return false;
    }
    if (filters.assigneeManager && filters.assigneeManager !== '') {
      if (extractAssigneeManager(item) !== filters.assigneeManager) return false;
    }
    if (filters.staleness && filters.staleness !== '') {
      const stale = isStale(item);
      if (filters.staleness === 'stale' && !stale) return false;
      if (filters.staleness === 'fresh' && stale) return false;
    }
    return true;
  });
}

const SELECT_STYLE = {
  padding: '0.35rem 0.5rem',
  fontSize: '0.8rem',
  border: '1px solid #ced4da',
  borderRadius: '3px',
  backgroundColor: '#fff',
  cursor: 'pointer',
  minWidth: '110px'
};

const LABEL_STYLE = {
  fontSize: '0.78rem',
  color: '#6c757d',
  whiteSpace: 'nowrap',
  marginRight: '2px'
};

const RISK_COLORS = {
  'Red': '#c53030',
  'Yellow': '#b7791f',
  'Green': '#276749',
  'Not Set': '#6c757d'
};

/**
 * ReleaseVersionFilterBar
 *
 * Renders a compact horizontal filter bar derived purely from the loaded items.
 * All filters are client-side — no re-fetch.
 *
 * Props:
 *   items           {commit: [], longTermFunded: []} — the full (unfiltered) loaded data
 *   activeFilters   {risk, status, assignee, staleness}
 *   onFilterChange  (key, value) => void
 *   activeSection   '' | 'commit' | 'longTermFunded'
 *   onSectionChange (value) => void
 *   totalCount      number — total items before filter
 *   filteredCount   number — total items after filter
 */
function ReleaseVersionFilterBar({
  items,
  activeFilters,
  onFilterChange,
  activeSection,
  onSectionChange,
  totalCount,
  filteredCount,
  showSection = true
}) {
  const allItems = useMemo(
    () => [...(items?.commit || []), ...(items?.longTermFunded || [])],
    [items]
  );

  // Derive unique option sets from the full data (not filtered) so options don't disappear while filtering
  const riskOptions = useMemo(() => {
    const seen = new Set();
    allItems.forEach(item => seen.add(extractRisk(item)));
    // Sort: Red, Yellow, Green, Not Set, then any others alphabetically
    const priority = ['Red', 'Yellow', 'Green', 'Not Set'];
    const sorted = [...seen].sort((a, b) => {
      const ia = priority.findIndex(p => a.toLowerCase().includes(p.toLowerCase()));
      const ib = priority.findIndex(p => b.toLowerCase().includes(p.toLowerCase()));
      const pa = ia === -1 ? 99 : ia;
      const pb = ib === -1 ? 99 : ib;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
    return sorted;
  }, [allItems]);

  const statusOptions = useMemo(() => {
    const seen = new Set();
    allItems.forEach(item => { const s = extractStatus(item); if (s) seen.add(s); });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [allItems]);

  const assigneeOptions = useMemo(() => {
    const seen = new Set();
    allItems.forEach(item => seen.add(extractAssignee(item)));
    return [...seen].sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [allItems]);

  const assigneeManagerOptions = useMemo(() => {
    const seen = new Set();
    allItems.forEach(item => seen.add(extractAssigneeManager(item)));
    return [...seen].sort((a, b) => {
      if (a === 'No Manager') return 1;
      if (b === 'No Manager') return -1;
      return a.localeCompare(b);
    });
  }, [allItems]);

  const hasActiveFilters =
    (activeFilters.risk !== '') ||
    (activeFilters.status !== '') ||
    (activeFilters.assignee !== '') ||
    (activeFilters.assigneeManager !== '') ||
    (activeFilters.staleness !== '') ||
    (activeSection !== '');

  const isFiltered = filteredCount !== totalCount;

  if (allItems.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      flexWrap: 'wrap',
      backgroundColor: '#f0f4f8',
      border: '1px solid #d0dce8',
      borderRadius: '4px',
      padding: '0.5rem 0.75rem',
      marginBottom: '0.75rem',
      fontSize: '0.8rem'
    }}>
      {/* Section filter */}
      {showSection && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={LABEL_STYLE}>Section:</span>
          <select
            style={SELECT_STYLE}
            value={activeSection}
            onChange={e => onSectionChange(e.target.value)}
          >
            <option value="">Both</option>
            <option value="commit">Commit only</option>
            <option value="longTermFunded">Long-term-funded only</option>
          </select>
        </div>
      )}

      {/* Risk filter */}
      {riskOptions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={LABEL_STYLE}>Risk:</span>
          <select
            style={{
              ...SELECT_STYLE,
              ...(activeFilters.risk ? {
                borderColor: RISK_COLORS[activeFilters.risk] || '#0066cc',
                color: RISK_COLORS[activeFilters.risk] || '#0066cc',
                fontWeight: 600
              } : {})
            }}
            value={activeFilters.risk}
            onChange={e => onFilterChange('risk', e.target.value)}
          >
            <option value="">All</option>
            {riskOptions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}

      {/* Status filter */}
      {statusOptions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={LABEL_STYLE}>Status:</span>
          <select
            style={{
              ...SELECT_STYLE,
              ...(activeFilters.status ? { borderColor: '#0066cc', color: '#0066cc', fontWeight: 600 } : {})
            }}
            value={activeFilters.status}
            onChange={e => onFilterChange('status', e.target.value)}
          >
            <option value="">All</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {/* Assignee filter */}
      {assigneeOptions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={LABEL_STYLE}>Assignee:</span>
          <select
            style={{
              ...SELECT_STYLE,
              ...(activeFilters.assignee ? { borderColor: '#0066cc', color: '#0066cc', fontWeight: 600 } : {})
            }}
            value={activeFilters.assignee}
            onChange={e => onFilterChange('assignee', e.target.value)}
          >
            <option value="">All</option>
            {assigneeOptions.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      )}

      {/* Assignee Manager filter */}
      {assigneeManagerOptions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={LABEL_STYLE}>Assignee Mgr:</span>
          <select
            style={{
              ...SELECT_STYLE,
              ...(activeFilters.assigneeManager ? { borderColor: '#0066cc', color: '#0066cc', fontWeight: 600 } : {})
            }}
            value={activeFilters.assigneeManager}
            onChange={e => onFilterChange('assigneeManager', e.target.value)}
          >
            <option value="">All</option>
            {assigneeManagerOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Staleness filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={LABEL_STYLE}>Status update:</span>
        <select
          style={{
            ...SELECT_STYLE,
            ...(activeFilters.staleness ? { borderColor: '#0066cc', color: '#0066cc', fontWeight: 600 } : {})
          }}
          value={activeFilters.staleness}
          onChange={e => onFilterChange('staleness', e.target.value)}
        >
          <option value="">All</option>
          <option value="stale">Stale / missing (&gt;10 days)</option>
          <option value="fresh">Updated recently</option>
        </select>
      </div>

      {/* Count badge + clear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
        {isFiltered && (
          <span style={{
            backgroundColor: '#0066cc',
            color: '#fff',
            borderRadius: '12px',
            padding: '0.1rem 0.55rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}>
            {filteredCount} / {totalCount}
          </span>
        )}
        {!isFiltered && (
          <span style={{ color: '#6c757d', fontSize: '0.75rem' }}>{totalCount} items</span>
        )}
        {hasActiveFilters && (
          <button
            onClick={() => {
              onFilterChange('risk', '');
              onFilterChange('status', '');
              onFilterChange('assignee', '');
              onFilterChange('assigneeManager', '');
              onFilterChange('staleness', '');
              onSectionChange('');
            }}
            style={{
              padding: '0.2rem 0.6rem',
              fontSize: '0.75rem',
              backgroundColor: 'transparent',
              border: '1px solid #6c757d',
              borderRadius: '3px',
              cursor: 'pointer',
              color: '#6c757d',
              whiteSpace: 'nowrap'
            }}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

export default ReleaseVersionFilterBar;
