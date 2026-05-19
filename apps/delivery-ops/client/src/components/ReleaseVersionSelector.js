import React, { useRef, useState, useEffect } from 'react';

/**
 * ReleaseVersionSelector Component
 *
 * Handles version selection dropdown/input, the Load button,
 * and a Download split-button (Gantt PNG / Report Excel / Report HTML / Both).
 *
 * Props:
 *   versions, selectedVersion, defaultVersion, showVersionDropdown,
 *   loadingVersions, loadingItems, jiraToken,
 *   onVersionChange, onFetchItems,
 *   hasData          {boolean} - true once items are loaded (enables Download)
 *   hasGanttChart    {boolean} - true when ganttConfig is present
 *   downloading      {boolean} - set by parent while any download is in progress
 *   onDownload       {function(type)} - called with 'gantt'|'excel'|'html'|'both'
 */
function ReleaseVersionSelector({
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
  onDownload
}) {
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
          {showVersionDropdown && versions.length > 0 ? (
            <select
              id="release-version"
              value={selectedVersion ?? ''}
              onChange={onVersionChange}
              disabled={loadingItems}
              className="text-input"
              style={{ flex: '0 1 auto', minWidth: '200px', maxWidth: '300px', padding: '0.4rem', fontSize: '0.85rem' }}
            >
              <option value="">-- Select --</option>
              {versions.map(version => (
                <option key={version} value={version}>{version}</option>
              ))}
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
