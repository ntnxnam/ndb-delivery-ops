import React, { useRef, useState, useEffect } from 'react';

/**
 * ReleaseVersionSelector Component
 *
 * Handles version selection dropdown/input, the Load button,
 * and a Download split-button (Gantt PNG / Report Excel / Report HTML / Both).
 *
 * Props:
 *   activeVersions   {Array}   - unreleased versions (NDB-*, master, Era Future)
 *   inactiveVersions {Array}   - released/past versions (NDB-*)
 *   versions         {Array}   - legacy flat list; used as fallback when
 *                                activeVersions is not provided
 *   selectedVersion, defaultVersion, showVersionDropdown,
 *   loadingVersions, loadingItems, jiraToken,
 *   onVersionChange, onFetchItems,
 *   hasData          {boolean} - true once items are loaded (enables Download)
 *   hasGanttChart    {boolean} - true when ganttConfig is present
 *   downloading      {boolean} - set by parent while any download is in progress
 *   onDownload       {function(type)} - called with 'gantt'|'excel'|'html'|'both'
 */
function ReleaseVersionSelector({
  activeVersions: activeVersionsProp,
  inactiveVersions: inactiveVersionsProp,
  versions,
  selectedVersion,
  defaultVersion,
  showVersionDropdown,
  loadingVersions,
  loadingItems,
  jiraToken,
  onVersionChange,
  onFetchItems,
  hasData = false,
  hasGanttChart = false,
  downloading = false,
  onDownload,
  onGenerateBriefing,
  briefingState = 'idle', // idle | loading | done | error
}) {
  // When the parent passes pre-split lists (new API), use them directly.
  // Fall back to splitting the flat `versions` prop with the same rule for
  // legacy callers that haven't been updated yet.
  const activeVersions = activeVersionsProp ?? (versions || []).filter((v) => {
    const name = typeof v === 'string' ? v : v.name;
    return (name.toUpperCase().startsWith('NDB-') || name === 'master' || name === 'Era Future') &&
           !(typeof v === 'object' ? v.released : false);
  });
  const inactiveVersions = inactiveVersionsProp ?? (versions || []).filter((v) => {
    const name = typeof v === 'string' ? v : v.name;
    return (name.toUpperCase().startsWith('NDB-') || name === 'master' || name === 'Era Future') &&
           (typeof v === 'object' ? v.released : false);
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const canDownload = hasData && !downloading && !loadingItems;

  const handleOption = (type) => {
    setMenuOpen(false);
    if (onDownload) onDownload(type);
  };

  const BTN = {
    padding: '0.4rem 0.8rem',
    color: 'white',
    border: 'none',
    borderRadius: '0',
    whiteSpace: 'nowrap',
    fontSize: '0.85rem',
    cursor: 'pointer',
  };

  const MENU_ITEM = {
    display: 'block',
    width: '100%',
    padding: '0.45rem 0.9rem',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    fontSize: '0.82rem',
    color: '#172B4D',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
      {loadingVersions ? (
        <p style={{ margin: 0, fontSize: '0.875rem' }}>Loading release versions...</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Version label */}
          <label
            htmlFor="release-version"
            style={{ margin: 0, marginRight: '8px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
          >
            Release Version:
          </label>

          {/* Version picker */}
          {showVersionDropdown && (activeVersions.length > 0 || inactiveVersions.length > 0) ? (
            <select
              id="release-version"
              value={selectedVersion ?? ''}
              onChange={onVersionChange}
              disabled={loadingItems}
              className="text-input"
              style={{ flex: '0 1 auto', minWidth: '200px', maxWidth: '300px', padding: '0.4rem', fontSize: '0.85rem' }}
            >
              <option value="">-- Select --</option>
              {activeVersions.map((v) => {
                const name = typeof v === 'string' ? v : v.name;
                return <option key={name} value={name}>{name}</option>;
              })}
              {inactiveVersions.length > 0 && (
                <optgroup label="── Past Releases ──">
                  {inactiveVersions.map((v) => {
                    const name = typeof v === 'string' ? v : v.name;
                    return <option key={name} value={name}>{name}</option>;
                  })}
                </optgroup>
              )}
            </select>
          ) : (
            <input
              id="release-version"
              type="text"
              value={selectedVersion || defaultVersion || ''}
              readOnly
              disabled={loadingItems}
              className="text-input"
              style={{
                flex: '0 1 auto', minWidth: '200px', maxWidth: '300px',
                padding: '0.4rem', fontSize: '0.85rem',
                backgroundColor: '#f8f9fa', cursor: 'not-allowed'
              }}
              placeholder="Default release version"
            />
          )}

          {/* Load button */}
          <button
            type="button"
            onClick={onFetchItems}
            disabled={loadingItems || !selectedVersion || !jiraToken}
            style={{
              ...BTN,
              backgroundColor: '#28a745',
              opacity: loadingItems || !selectedVersion || !jiraToken ? 0.6 : 1,
              cursor: loadingItems || !selectedVersion || !jiraToken ? 'not-allowed' : 'pointer',
            }}
          >
            {loadingItems ? 'Loading...' : 'Load'}
          </button>

          {/* AI Briefing button — visible only after data is loaded */}
          {onGenerateBriefing && hasData && (
            <button
              type="button"
              onClick={onGenerateBriefing}
              disabled={!selectedVersion || !jiraToken || briefingState === 'loading'}
              title="Generate AI release briefing (health verdict, top blockers, 7-day action list)"
              style={{
                ...BTN,
                backgroundColor: briefingState === 'loading' ? '#6c9fd4'
                               : briefingState === 'done'    ? '#5c7cfa'
                               : '#845ef7',
                opacity: !selectedVersion || !jiraToken ? 0.6 : 1,
                cursor: !selectedVersion || !jiraToken || briefingState === 'loading' ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {briefingState === 'loading' ? '✦ Briefing…' : briefingState === 'done' ? '✦ Re-brief' : '✦ AI Briefing'}
            </button>
          )}

          {/* Download split button */}
          <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
            {/* Main label — clicking opens the menu directly */}
            <button
              type="button"
              disabled={!canDownload}
              onClick={() => setMenuOpen(o => !o)}
              style={{
                ...BTN,
                backgroundColor: canDownload ? '#0052cc' : '#6c9fd4',
                opacity: canDownload ? 1 : 0.6,
                cursor: canDownload ? 'pointer' : 'not-allowed',
                paddingRight: '0.5rem',
                borderRight: '1px solid rgba(255,255,255,0.3)',
              }}
              title={hasData ? 'Download report or Gantt' : 'Load data first'}
            >
              {downloading ? 'Downloading…' : '↓ Download'}
            </button>

            {/* Chevron */}
            <button
              type="button"
              disabled={!canDownload}
              onClick={() => setMenuOpen(o => !o)}
              style={{
                ...BTN,
                backgroundColor: canDownload ? '#0052cc' : '#6c9fd4',
                opacity: canDownload ? 1 : 0.6,
                cursor: canDownload ? 'pointer' : 'not-allowed',
                padding: '0.4rem 0.5rem',
              }}
              aria-label="Download options"
            >
              ▾
            </button>

            {/* Dropdown menu */}
            {menuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                zIndex: 1000,
                background: '#fff',
                border: '1px solid #ccc',
                borderRadius: '3px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: '200px',
              }}>
                {/* Gantt PNG */}
                {hasGanttChart && (
                  <button
                    style={MENU_ITEM}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f4f8'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    onClick={() => handleOption('gantt')}
                  >
                    🖼 Gantt chart (.png)
                  </button>
                )}

                {/* Divider after gantt */}
                {hasGanttChart && (
                  <div style={{ borderTop: '1px solid #eee', margin: '2px 0' }} />
                )}

                {/* Excel */}
                <button
                  style={MENU_ITEM}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  onClick={() => handleOption('excel')}
                >
                  📊 Report — Excel (.xlsx)
                </button>

                {/* HTML */}
                <button
                  style={MENU_ITEM}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  onClick={() => handleOption('html')}
                >
                  🌐 Report — HTML (.html)
                </button>

                {/* Both — only if gantt is available */}
                {hasGanttChart && (
                  <>
                    <div style={{ borderTop: '1px solid #eee', margin: '2px 0' }} />
                    <button
                      style={MENU_ITEM}
                      onMouseEnter={e => e.currentTarget.style.background = '#f0f4f8'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      onClick={() => handleOption('both')}
                    >
                      📦 Both (Gantt + Excel)
                    </button>
                  </>
                )}

                {/* PDF */}
                <div style={{ borderTop: '1px solid #eee', margin: '2px 0' }} />
                <button
                  style={MENU_ITEM}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  onClick={() => handleOption('pdf')}
                >
                  🖨 Download as PDF (.pdf)
                </button>

                {/* Note about filters */}
                <div style={{
                  padding: '0.4rem 0.9rem',
                  fontSize: '10px',
                  color: '#6c757d',
                  borderTop: '1px solid #eee',
                  marginTop: '2px'
                }}>
                  Report uses currently applied filters
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ReleaseVersionSelector;
