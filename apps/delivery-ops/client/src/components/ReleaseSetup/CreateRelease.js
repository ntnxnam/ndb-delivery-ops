import React, { useState, useCallback, useMemo } from 'react';
import { authenticatedPost } from '../../utils/api';
import { generateFilterChain, releaseProjectsForTeam, isValidVersionName } from '../../utils/jqlTemplates';
import { useTeam } from '../../contexts/TeamContext';
import { STATUS, statusLabel, statusColor, statusIcon, cardStyle, sectionHeading } from './shared';

function CreateRelease() {
  const { selectedTeam } = useTeam();
  const releaseProjects = useMemo(
    () => releaseProjectsForTeam(selectedTeam?.projectKey),
    [selectedTeam?.projectKey]
  );
  const [version, setVersion] = useState('');
  const [excludeVersion, setExcludeVersion] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [phase, setPhase] = useState('input');

  const [versionStatuses, setVersionStatuses] = useState({});
  const [versionErrors, setVersionErrors] = useState({});

  const [filterChain, setFilterChain] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState({});
  const [filterErrors, setFilterErrors] = useState({});
  const [filterEdits, setFilterEdits] = useState({});

  const [checkError, setCheckError] = useState('');

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const resetAll = useCallback(() => {
    setPhase('input');
    setVersionStatuses({});
    setVersionErrors({});
    setFilterChain([]);
    setFilterStatuses({});
    setFilterErrors({});
    setFilterEdits({});
    setCheckError('');
  }, []);

  const handleCheck = useCallback(async () => {
    if (!isValidVersionName(version)) {
      setCheckError('Please enter a version name.');
      return;
    }
    if (!jiraToken) {
      setCheckError('JIRA token not found. Please log out and log back in.');
      return;
    }
    setCheckError('');
    setPhase('checking');

    const newVersionStatuses = {};
    const newVersionErrors = {};

    for (const proj of releaseProjects) {
      newVersionStatuses[proj] = STATUS.CHECKING;
      setVersionStatuses({ ...newVersionStatuses });

      try {
        const res = await authenticatedPost('/api/jira/check-version-exists', { projectKey: proj, versionName: version }, { jiraToken, username });
        newVersionStatuses[proj] = res.data?.exists ? STATUS.EXISTS : STATUS.MISSING;
      } catch (err) {
        newVersionStatuses[proj] = STATUS.ERROR;
        newVersionErrors[proj] = err.response?.data?.error || err.message;
      }
      setVersionStatuses({ ...newVersionStatuses });
      setVersionErrors({ ...newVersionErrors });
    }

    const chain = generateFilterChain(version, excludeVersion);
    setFilterChain(chain);

    const newFilterStatuses = {};
    const newFilterErrors = {};
    const newFilterEdits = {};

    for (const f of chain) {
      newFilterStatuses[f.name] = STATUS.CHECKING;
      setFilterStatuses({ ...newFilterStatuses });

      try {
        const res = await authenticatedPost('/api/jira/check-filter-exists', { filterName: f.name }, { jiraToken, username });
        newFilterStatuses[f.name] = res.data?.exists ? STATUS.EXISTS : STATUS.MISSING;
      } catch (err) {
        newFilterStatuses[f.name] = STATUS.ERROR;
        newFilterErrors[f.name] = err.response?.data?.error || err.message;
      }

      newFilterEdits[f.name] = { name: f.name, jql: f.jql };
      setFilterStatuses({ ...newFilterStatuses });
      setFilterErrors({ ...newFilterErrors });
      setFilterEdits({ ...newFilterEdits });
    }

    setPhase('checked');
  }, [version, excludeVersion, jiraToken, username, releaseProjects]);

  const handleCreateVersion = useCallback(async (proj) => {
    setVersionStatuses(prev => ({ ...prev, [proj]: STATUS.CREATING }));
    setVersionErrors(prev => ({ ...prev, [proj]: undefined }));

    try {
      await authenticatedPost('/api/jira/create-version', { projectKey: proj, versionName: version, releaseDate: releaseDate || undefined }, { jiraToken, username });
      setVersionStatuses(prev => ({ ...prev, [proj]: STATUS.CREATED }));
    } catch (err) {
      setVersionStatuses(prev => ({ ...prev, [proj]: STATUS.ERROR }));
      setVersionErrors(prev => ({ ...prev, [proj]: err.response?.data?.error || err.message }));
    }
  }, [version, releaseDate, jiraToken, username]);

  const handleSkipVersion = useCallback((proj) => {
    setVersionStatuses(prev => ({ ...prev, [proj]: STATUS.SKIPPED }));
  }, []);

  const handleCreateFilter = useCallback(async (filterDef) => {
    const edits = filterEdits[filterDef.name] || {};
    const finalName = (edits.name || filterDef.name).trim();
    const finalJql = (edits.jql || filterDef.jql).trim();

    setFilterStatuses(prev => ({ ...prev, [filterDef.name]: STATUS.CREATING }));
    setFilterErrors(prev => ({ ...prev, [filterDef.name]: undefined }));

    try {
      await authenticatedPost('/api/jira/create-filter', {
        filterName: finalName,
        jql: finalJql,
        description: `Auto-created by Release Setup for ${version}`
      }, { jiraToken, username });
      setFilterStatuses(prev => ({ ...prev, [filterDef.name]: STATUS.CREATED }));
    } catch (err) {
      setFilterStatuses(prev => ({ ...prev, [filterDef.name]: STATUS.ERROR }));
      setFilterErrors(prev => ({ ...prev, [filterDef.name]: err.response?.data?.error || err.message }));
    }
  }, [filterEdits, version, jiraToken, username]);

  const handleSkipFilter = useCallback((filterDef) => {
    setFilterStatuses(prev => ({ ...prev, [filterDef.name]: STATUS.SKIPPED }));
  }, []);

  const handleFilterEdit = useCallback((origName, field, value) => {
    setFilterEdits(prev => ({
      ...prev,
      [origName]: { ...prev[origName], [field]: value }
    }));
  }, []);

  const allVersionsDone = releaseProjects.every(p => [STATUS.EXISTS, STATUS.CREATED, STATUS.SKIPPED, STATUS.ERROR].includes(versionStatuses[p]));
  const allFiltersDone = filterChain.length > 0 && filterChain.every(f => [STATUS.EXISTS, STATUS.CREATED, STATUS.SKIPPED, STATUS.ERROR].includes(filterStatuses[f.name]));

  const getActiveVersionIdx = () => {
    const idx = releaseProjects.findIndex(p => versionStatuses[p] === STATUS.MISSING || versionStatuses[p] === STATUS.ERROR);
    return idx >= 0 ? idx : releaseProjects.length;
  };

  const getActiveFilterIdx = () => {
    const idx = filterChain.findIndex(f => filterStatuses[f.name] === STATUS.MISSING || filterStatuses[f.name] === STATUS.ERROR);
    return idx >= 0 ? idx : filterChain.length;
  };

  const hasMissingVersions = releaseProjects.some(p => versionStatuses[p] === STATUS.MISSING);
  const hasMissingFilters = filterChain.some(f => filterStatuses[f.name] === STATUS.MISSING);
  const everythingExists = phase === 'checked' && !hasMissingVersions && !hasMissingFilters
    && releaseProjects.every(p => versionStatuses[p] === STATUS.EXISTS)
    && filterChain.every(f => filterStatuses[f.name] === STATUS.EXISTS);

  return (
    <div>
      <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>
        Create fixVersions across JIRA projects and set up the saved filter chain for a new release.
      </p>

      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>Step 1: Release Information</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Version Name</label>
            <input
              type="text"
              value={version}
              onChange={e => { setVersion(e.target.value); resetAll(); }}
              placeholder="NDB-2.12"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Exclude Version (for root filter)</label>
            <input
              type="text"
              value={excludeVersion}
              onChange={e => { setExcludeVersion(e.target.value); if (phase !== 'input') resetAll(); }}
              placeholder="NDB-2.13"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>Release Date</label>
            <input
              type="date"
              value={releaseDate}
              onChange={e => setReleaseDate(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem' }}
            />
          </div>
          <div>
            <button
              onClick={handleCheck}
              disabled={!version.trim() || phase === 'checking'}
              style={{
                padding: '7px 16px',
                backgroundColor: '#007bff',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: !version.trim() || phase === 'checking' ? 'not-allowed' : 'pointer',
                opacity: !version.trim() || phase === 'checking' ? 0.6 : 1,
                fontSize: '0.85rem',
                whiteSpace: 'nowrap',
              }}
            >
              {phase === 'checking' ? 'Checking\u2026' : 'Check JIRA'}
            </button>
          </div>
        </div>
        {checkError && <div style={{ color: '#dc3545', fontSize: '0.82rem', marginTop: 8 }}>{checkError}</div>}
      </div>

      {(phase === 'checked' || phase === 'checking' || phase === 'versions' || phase === 'filters' || phase === 'done') && (
        <>
          {everythingExists && (
            <div style={{ ...cardStyle, background: '#d4edda', borderColor: '#28a745' }}>
              <strong style={{ color: '#155724' }}>All set.</strong>
              <span style={{ color: '#155724', marginLeft: 8 }}>
                The fixVersion and all 5 filters already exist in JIRA for {version}. Nothing to create.
              </span>
            </div>
          )}

          <div style={sectionHeading}>fixVersions ({version})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {releaseProjects.map(proj => (
              <div key={proj} style={{
                ...cardStyle,
                marginBottom: 0,
                borderLeft: `4px solid ${statusColor(versionStatuses[proj])}`,
                opacity: versionStatuses[proj] === STATUS.SKIPPED ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{proj}</strong>
                  <span style={{ color: statusColor(versionStatuses[proj]), fontSize: '0.8rem', fontWeight: 500 }}>
                    {statusIcon(versionStatuses[proj])} {statusLabel(versionStatuses[proj])}
                  </span>
                </div>
                {versionErrors[proj] && (
                  <div style={{ color: '#dc3545', fontSize: '0.75rem', marginTop: 4 }}>{versionErrors[proj]}</div>
                )}
              </div>
            ))}
          </div>

          <div style={sectionHeading}>Saved Filters</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filterChain.map((f, idx) => (
              <div key={f.name} style={{
                ...cardStyle,
                marginBottom: 0,
                borderLeft: `4px solid ${statusColor(filterStatuses[f.name])}`,
                opacity: filterStatuses[f.name] === STATUS.SKIPPED ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem' }}>
                    <strong>{idx + 1}.</strong> {f.name}
                  </span>
                  <span style={{ color: statusColor(filterStatuses[f.name]), fontSize: '0.8rem', fontWeight: 500 }}>
                    {statusIcon(filterStatuses[f.name])} {statusLabel(filterStatuses[f.name])}
                  </span>
                </div>
                {filterErrors[f.name] && (
                  <div style={{ color: '#dc3545', fontSize: '0.75rem', marginTop: 4 }}>{filterErrors[f.name]}</div>
                )}
              </div>
            ))}
          </div>

          {phase === 'checked' && (hasMissingVersions || hasMissingFilters) && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setPhase(hasMissingVersions ? 'versions' : 'filters')}
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                {hasMissingVersions ? 'Proceed to Create Versions' : 'Proceed to Create Filters'}
              </button>
            </div>
          )}
        </>
      )}

      {phase === 'versions' && (
        <>
          <div style={sectionHeading}>Create Missing fixVersions</div>
          {releaseProjects.map((proj, idx) => {
            const s = versionStatuses[proj];
            if (s === STATUS.EXISTS || s === STATUS.CREATED || s === STATUS.SKIPPED) return null;
            const isActive = idx === getActiveVersionIdx();
            if (!isActive) return null;

            return (
              <div key={proj} style={{ ...cardStyle, borderColor: '#007bff', borderWidth: 2 }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>Create fixVersion in {proj}</h4>
                <table style={{ fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr><td style={{ padding: '3px 12px 3px 0', color: '#666' }}>Version name:</td><td><strong>{version}</strong></td></tr>
                    <tr><td style={{ padding: '3px 12px 3px 0', color: '#666' }}>Project:</td><td><strong>{proj}</strong></td></tr>
                    <tr><td style={{ padding: '3px 12px 3px 0', color: '#666' }}>Release date:</td><td>{releaseDate || <em style={{ color: '#999' }}>not set</em>}</td></tr>
                  </tbody>
                </table>
                {versionErrors[proj] && (
                  <div style={{ color: '#dc3545', fontSize: '0.8rem', margin: '8px 0' }}>{versionErrors[proj]}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => handleSkipVersion(proj)}
                    disabled={s === STATUS.CREATING}
                    style={{ padding: '6px 14px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.82rem' }}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleCreateVersion(proj)}
                    disabled={s === STATUS.CREATING}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: '#28a745',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: s === STATUS.CREATING ? 'not-allowed' : 'pointer',
                      opacity: s === STATUS.CREATING ? 0.6 : 1,
                      fontSize: '0.82rem',
                    }}
                  >
                    {s === STATUS.CREATING ? 'Creating\u2026' : s === STATUS.ERROR ? 'Retry' : 'Confirm & Create'}
                  </button>
                </div>
              </div>
            );
          })}

          {allVersionsDone && (
            <div style={{ marginTop: 12 }}>
              {hasMissingFilters ? (
                <button
                  onClick={() => setPhase('filters')}
                  style={{ padding: '8px 20px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  Proceed to Create Filters
                </button>
              ) : (
                <div style={{ ...cardStyle, background: '#d4edda', borderColor: '#28a745' }}>
                  <strong style={{ color: '#155724' }}>Done!</strong>
                  <span style={{ color: '#155724', marginLeft: 8 }}>All versions created. Filters already exist.</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {phase === 'filters' && (
        <>
          <div style={sectionHeading}>Create Saved Filters (in dependency order)</div>
          {filterChain.map((f, idx) => {
            const s = filterStatuses[f.name];
            if (s === STATUS.EXISTS || s === STATUS.CREATED || s === STATUS.SKIPPED) return null;
            const activeIdx = getActiveFilterIdx();
            const isActive = idx === activeIdx;
            if (!isActive) return null;

            const edits = filterEdits[f.name] || {};
            const depsMet = f.dependsOn.every(dep => {
              const depStatus = filterStatuses[dep];
              return depStatus === STATUS.EXISTS || depStatus === STATUS.CREATED;
            });
            const depsSkipped = f.dependsOn.some(dep => filterStatuses[dep] === STATUS.SKIPPED);
            const depsFailed = f.dependsOn.some(dep => filterStatuses[dep] === STATUS.ERROR);

            return (
              <div key={f.name} style={{ ...cardStyle, borderColor: '#007bff', borderWidth: 2 }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem' }}>
                  Filter {f.order} of {filterChain.length}
                </h4>

                {f.dependsOn.length > 0 && (
                  <div style={{ fontSize: '0.78rem', marginBottom: 10, padding: '6px 10px', background: '#f8f9fa', borderRadius: 4 }}>
                    <span style={{ color: '#666' }}>Depends on: </span>
                    {f.dependsOn.map(dep => {
                      const ds = filterStatuses[dep];
                      return (
                        <span key={dep} style={{ marginRight: 8, color: statusColor(ds), fontWeight: 500 }}>
                          {statusIcon(ds)} {dep}
                        </span>
                      );
                    })}
                  </div>
                )}

                {(depsSkipped || depsFailed) && !depsMet && (
                  <div style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px', borderRadius: 4, fontSize: '0.78rem', marginBottom: 10 }}>
                    Warning: One or more dependencies were {depsSkipped ? 'skipped' : 'failed'}. Creating this filter may produce errors in JIRA.
                    You can still proceed if the dependency exists under a different name.
                  </div>
                )}

                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: 3, color: '#555' }}>Filter Name</label>
                <input
                  type="text"
                  value={edits.name ?? f.name}
                  onChange={e => handleFilterEdit(f.name, 'name', e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.82rem', marginBottom: 10, fontFamily: 'monospace' }}
                />

                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, marginBottom: 3, color: '#555' }}>JQL (review and edit if needed)</label>
                <textarea
                  value={edits.jql ?? f.jql}
                  onChange={e => handleFilterEdit(f.name, 'jql', e.target.value)}
                  rows={Math.max(3, Math.ceil((edits.jql || f.jql).length / 80))}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: 4,
                    fontSize: '0.8rem',
                    fontFamily: 'monospace',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    marginBottom: 6,
                  }}
                />

                {filterErrors[f.name] && (
                  <div style={{ color: '#dc3545', fontSize: '0.8rem', margin: '6px 0' }}>{filterErrors[f.name]}</div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => handleSkipFilter(f)}
                    disabled={s === STATUS.CREATING}
                    style={{ padding: '6px 14px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.82rem' }}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleCreateFilter(f)}
                    disabled={s === STATUS.CREATING}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: '#28a745',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: s === STATUS.CREATING ? 'not-allowed' : 'pointer',
                      opacity: s === STATUS.CREATING ? 0.6 : 1,
                      fontSize: '0.82rem',
                    }}
                  >
                    {s === STATUS.CREATING ? 'Creating\u2026' : s === STATUS.ERROR ? 'Retry' : 'Confirm & Create'}
                  </button>
                </div>
              </div>
            );
          })}

          {allFiltersDone && (
            <div style={{ ...cardStyle, background: '#d4edda', borderColor: '#28a745', marginTop: 12 }}>
              <strong style={{ color: '#155724' }}>Release setup complete.</strong>
              <span style={{ color: '#155724', marginLeft: 8 }}>
                All versions and filters for {version} have been processed.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CreateRelease;
