import React, { useState, useCallback, useMemo } from 'react';
import { authenticatedPost } from '../../shared/services/apiService';
import { generateFilterChain, releaseProjectsForTeam, isValidVersionName } from '../../utils/jqlTemplates';
import { useTeam } from '../../contexts/TeamContext';
import { STATUS, statusLabel, statusColor, statusIcon, cardStyle, sectionHeading } from './shared';
import { JchFallbackBanner } from './JchFallbackBanner';

// audience: rm — Release Manager creating fixVersions + saved filters; needs JCH fallback when not project admin
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
  const [selectedVersions, setSelectedVersions] = useState({});

  const [filterChain, setFilterChain] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState({});
  const [filterErrors, setFilterErrors] = useState({});
  const [filterEdits, setFilterEdits] = useState({});
  const [selectedFilters, setSelectedFilters] = useState({});

  const [checkError, setCheckError] = useState('');
  const [bulkVersionsRunning, setBulkVersionsRunning] = useState(false);
  const [bulkFiltersRunning, setBulkFiltersRunning] = useState(false);
  const [bulkCompanionRunning, setBulkCompanionRunning] = useState(false);

  const [companionTickets, setCompanionTickets] = useState([]);
  const [companionStatuses, setCompanionStatuses] = useState({});
  const [companionErrors, setCompanionErrors] = useState({});
  const [selectedCompanion, setSelectedCompanion] = useState({});

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const [jchStatus, setJchStatus] = useState({});

  const resetAll = useCallback(() => {
    setPhase('input');
    setVersionStatuses({});
    setVersionErrors({});
    setSelectedVersions({});
    setFilterChain([]);
    setFilterStatuses({});
    setFilterErrors({});
    setFilterEdits({});
    setSelectedFilters({});
    setCompanionTickets([]);
    setCompanionStatuses({});
    setCompanionErrors({});
    setSelectedCompanion({});
    setCheckError('');
    setJchStatus({});
    setBulkVersionsRunning(false);
    setBulkFiltersRunning(false);
    setBulkCompanionRunning(false);
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
    const newSelectedVersions = {};

    for (const proj of releaseProjects) {
      newVersionStatuses[proj] = STATUS.CHECKING;
      setVersionStatuses({ ...newVersionStatuses });
      try {
        const res = await authenticatedPost('/api/jira/check-version-exists', { projectKey: proj, versionName: version }, { jiraToken, username });
        newVersionStatuses[proj] = res.data?.exists ? STATUS.EXISTS : STATUS.MISSING;
        if (newVersionStatuses[proj] === STATUS.MISSING) newSelectedVersions[proj] = true;
      } catch (err) {
        newVersionStatuses[proj] = STATUS.ERROR;
        newVersionErrors[proj] = err.response?.data?.error || err.message;
        newSelectedVersions[proj] = true;
      }
      setVersionStatuses({ ...newVersionStatuses });
      setVersionErrors({ ...newVersionErrors });
    }
    setSelectedVersions(newSelectedVersions);

    const chain = generateFilterChain(version, excludeVersion);
    setFilterChain(chain);

    const newFilterStatuses = {};
    const newFilterErrors = {};
    const newFilterEdits = {};
    const newSelectedFilters = {};

    for (const f of chain) {
      newFilterStatuses[f.name] = STATUS.CHECKING;
      setFilterStatuses({ ...newFilterStatuses });
      try {
        const res = await authenticatedPost('/api/jira/check-filter-exists', { filterName: f.name }, { jiraToken, username });
        newFilterStatuses[f.name] = res.data?.exists ? STATUS.EXISTS : STATUS.MISSING;
        if (newFilterStatuses[f.name] === STATUS.MISSING) newSelectedFilters[f.name] = true;
      } catch (err) {
        newFilterStatuses[f.name] = STATUS.ERROR;
        newFilterErrors[f.name] = err.response?.data?.error || err.message;
        newSelectedFilters[f.name] = true;
      }
      newFilterEdits[f.name] = { name: f.name, jql: f.jql };
      setFilterStatuses({ ...newFilterStatuses });
      setFilterErrors({ ...newFilterErrors });
      setFilterEdits({ ...newFilterEdits });
    }
    setSelectedFilters(newSelectedFilters);

    // Companion tickets check (LBDR×2, LEG×1, TECHPUBS×2, SDL×1) — highlight gaps if release already exists but tickets missing
    try {
      const res = await authenticatedPost('/api/jira/check-companion-tickets', { version }, { jiraToken, username });
      const tickets = Array.isArray(res.data?.tickets) ? res.data.tickets : [];
      setCompanionTickets(tickets);
      const newCompanionStatuses = {};
      const newCompanionErrors = {};
      const newSelectedCompanion = {};
      tickets.forEach(t => {
        newCompanionStatuses[t.id] = t.exists ? STATUS.EXISTS : STATUS.MISSING;
        if (t.error) newCompanionErrors[t.id] = t.error;
        if (!t.exists) newSelectedCompanion[t.id] = true;
      });
      setCompanionStatuses(newCompanionStatuses);
      setCompanionErrors(newCompanionErrors);
      setSelectedCompanion(newSelectedCompanion);
    } catch (err) {
      // non-blocking: leave companion section empty
      setCompanionTickets([]);
    }

    // JCH dedup: if version missing but JCH already exists, surface it so user doesn't create duplicate
    const newJchStatus = {};
    for (const proj of releaseProjects) {
      if (newVersionStatuses[proj] === STATUS.MISSING || newVersionStatuses[proj] === STATUS.ERROR) {
        try {
          const r = await authenticatedPost('/api/jira/check-jch-exists', { versionName: version, projectKey: proj }, { jiraToken, username });
          if (r.data?.exists) {
            newJchStatus[proj] = { state: 'created', key: r.data.key, url: r.data.url, alreadyExists: true, status: r.data.status };
          }
        } catch (_) {}
      }
    }
    if (Object.keys(newJchStatus).length) setJchStatus(prev => ({ ...prev, ...newJchStatus }));

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

  const handleCreateJchTicket = useCallback(async (proj) => {
    if (jchStatus[proj]?.state === 'creating' || jchStatus[proj]?.state === 'created') return;
    const errDetail = String(versionErrors[proj] || '').slice(0, 1000);
    setJchStatus(prev => ({ ...prev, [proj]: { state: 'creating' } }));
    try {
      const res = await authenticatedPost('/api/jira/create-jch-ticket', { versionName: version, projectKey: proj, errorDetail: errDetail, releaseDate: releaseDate || undefined }, { jiraToken, username });
      setJchStatus(prev => ({ ...prev, [proj]: { state: 'created', key: res.data?.key, url: res.data?.url } }));
    } catch (err) {
      setJchStatus(prev => ({ ...prev, [proj]: { state: 'error', error: err.response?.data?.error || err.message } }));
    }
  }, [version, releaseDate, versionErrors, jiraToken, username, jchStatus]);

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

  // Bulk handlers — UX punch list: Create All Selected in 1 click
  const handleBulkCreateVersions = useCallback(async () => {
    const targets = releaseProjects.filter(p => selectedVersions[p] && (versionStatuses[p] === STATUS.MISSING || versionStatuses[p] === STATUS.ERROR));
    if (!targets.length) return;
    setBulkVersionsRunning(true);
    for (const proj of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleCreateVersion(proj);
    }
    setBulkVersionsRunning(false);
  }, [releaseProjects, selectedVersions, versionStatuses, handleCreateVersion]);

  const handleBulkCreateFilters = useCallback(async () => {
    const targets = filterChain.filter(f => selectedFilters[f.name] && (filterStatuses[f.name] === STATUS.MISSING || filterStatuses[f.name] === STATUS.ERROR));
    if (!targets.length) return;
    setBulkFiltersRunning(true);
    for (const f of targets) {
      // sequential to respect chain order
      // eslint-disable-next-line no-await-in-loop
      await handleCreateFilter(f);
    }
    setBulkFiltersRunning(false);
  }, [filterChain, selectedFilters, filterStatuses, handleCreateFilter]);

  const handleCreateCompanionOne = useCallback(async (ticketId) => {
    setCompanionStatuses(prev => ({ ...prev, [ticketId]: STATUS.CREATING }));
    try {
      await authenticatedPost('/api/jira/create-companion-tickets', { version, ids: [ticketId] }, { jiraToken, username });
      setCompanionStatuses(prev => ({ ...prev, [ticketId]: STATUS.CREATED }));
    } catch (err) {
      setCompanionStatuses(prev => ({ ...prev, [ticketId]: STATUS.ERROR }));
      setCompanionErrors(prev => ({ ...prev, [ticketId]: err.response?.data?.error || err.message }));
    }
  }, [version, jiraToken, username]);

  const handleBulkCreateCompanion = useCallback(async () => {
    const targets = companionTickets.filter(t => selectedCompanion[t.id] && companionStatuses[t.id] === STATUS.MISSING);
    if (!targets.length) return;
    setBulkCompanionRunning(true);
    const ids = targets.map(t => t.id);
    try {
      const res = await authenticatedPost('/api/jira/create-companion-tickets', { version, ids }, { jiraToken, username });
      const createdIds = new Set((res.data?.created || []).map(c => c.id));
      setCompanionStatuses(prev => {
        const next = { ...prev };
        ids.forEach(id => { if (createdIds.has(id)) next[id] = STATUS.CREATED; else if (next[id] !== STATUS.CREATED) next[id] = STATUS.ERROR; });
        return next;
      });
      if (res.data?.skipped) {
        res.data.skipped.forEach(s => {
          if (s.error) setCompanionErrors(prev => ({ ...prev, [s.id]: s.error }));
        });
      }
    } catch (err) {
      ids.forEach(id => setCompanionStatuses(prev => ({ ...prev, [id]: STATUS.ERROR })));
      setCompanionErrors(prev => ({ ...prev, _bulk: err.response?.data?.error || err.message }));
    } finally {
      setBulkCompanionRunning(false);
    }
  }, [companionTickets, selectedCompanion, companionStatuses, version, jiraToken, username]);

  const hasMissingVersions = releaseProjects.some(p => versionStatuses[p] === STATUS.MISSING || versionStatuses[p] === STATUS.ERROR);
  const hasMissingFilters = filterChain.some(f => filterStatuses[f.name] === STATUS.MISSING || filterStatuses[f.name] === STATUS.ERROR);
  const hasMissingCompanion = companionTickets.some(t => companionStatuses[t.id] === STATUS.MISSING);
  const everythingExists = phase === 'checked' && !hasMissingVersions && !hasMissingFilters && !hasMissingCompanion
    && releaseProjects.every(p => versionStatuses[p] === STATUS.EXISTS)
    && filterChain.every(f => filterStatuses[f.name] === STATUS.EXISTS)
    && companionTickets.every(t => companionStatuses[t.id] === STATUS.EXISTS);

  const missingVersionCount = releaseProjects.filter(p => versionStatuses[p] === STATUS.MISSING || versionStatuses[p] === STATUS.ERROR).length;
  const missingFilterCount = filterChain.filter(f => filterStatuses[f.name] === STATUS.MISSING || filterStatuses[f.name] === STATUS.ERROR).length;
  const missingCompanionCount = companionTickets.filter(t => companionStatuses[t.id] === STATUS.MISSING).length;
  const selectedVersionCount = releaseProjects.filter(p => selectedVersions[p] && (versionStatuses[p] === STATUS.MISSING || versionStatuses[p] === STATUS.ERROR)).length;
  const selectedFilterCount = filterChain.filter(f => selectedFilters[f.name] && (filterStatuses[f.name] === STATUS.MISSING || filterStatuses[f.name] === STATUS.ERROR)).length;
  const selectedCompanionCount = companionTickets.filter(t => selectedCompanion[t.id] && companionStatuses[t.id] === STATUS.MISSING).length;

  return (
    <div>
      <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>
        Create fixVersions and the saved filter chain for a new release. Versions and filters are independent — you can create filters even if you lack admin for some projects (use JCH fallback for those versions).
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

      {(phase === 'checked' || phase === 'checking') && (
        <>
          {everythingExists && (
            <div style={{ ...cardStyle, background: '#d4edda', borderColor: '#28a745' }}>
              <strong style={{ color: '#155724' }}>All set.</strong>
              <span style={{ color: '#155724', marginLeft: 8 }}>
                The fixVersion and all 5 filters already exist in JIRA for {version}. Nothing to create.
              </span>
            </div>
          )}

          {/* FixVersions checklist — bulk create in 1 click */}
          <div style={{ ...sectionHeading, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>fixVersions ({version || '—'}) {missingVersionCount ? `· ${missingVersionCount} missing` : ''}</span>
            {hasMissingVersions && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={missingVersionCount > 0 && selectedVersionCount === missingVersionCount}
                  onChange={e => {
                    const checked = e.target.checked;
                    const next = {};
                    releaseProjects.forEach(p => {
                      if (versionStatuses[p] === STATUS.MISSING || versionStatuses[p] === STATUS.ERROR) next[p] = checked;
                    });
                    setSelectedVersions(next);
                  }}
                />
                Select all
              </label>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {releaseProjects.map(proj => {
              const s = versionStatuses[proj];
              const selectable = s === STATUS.MISSING || s === STATUS.ERROR;
              return (
                <div key={proj} style={{
                  ...cardStyle,
                  marginBottom: 0,
                  borderLeft: `4px solid ${statusColor(s)}`,
                  opacity: s === STATUS.SKIPPED ? 0.6 : 1,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: selectable ? 'pointer' : 'default', flex: 1, minWidth: 0 }}>
                      <input type="checkbox" disabled={!selectable} checked={!!selectedVersions[proj]} onChange={e => setSelectedVersions(prev => ({ ...prev, [proj]: e.target.checked }))} style={{ cursor: selectable ? 'pointer' : 'not-allowed' }} />
                      <strong style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj}</strong>
                    </label>
                    <span style={{ color: statusColor(s), fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {statusIcon(s)} {statusLabel(s)}
                    </span>
                  </div>
                  {selectable && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => handleCreateVersion(proj)} disabled={s === STATUS.CREATING} style={{ padding: '5px 10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: 4, cursor: s === STATUS.CREATING ? 'not-allowed' : 'pointer', opacity: s === STATUS.CREATING ? 0.6 : 1, fontSize: '0.75rem' }}>{s === STATUS.CREATING ? 'Creating…' : s === STATUS.ERROR ? 'Retry' : 'Create'}</button>
                      <button onClick={() => handleSkipVersion(proj)} disabled={s === STATUS.CREATING} style={{ padding: '5px 10px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}>Skip</button>
                    </div>
                  )}
                  {s === STATUS.ERROR && (
                    <>
                      {versionErrors[proj] && <div style={{ color: '#dc3545', fontSize: '0.72rem', marginTop: 6, wordBreak: 'break-word' }}>{versionErrors[proj]}</div>}
                      <JchFallbackBanner projectKey={proj} errorDetail={versionErrors[proj]} jchState={jchStatus[proj]} onFileJch={() => handleCreateJchTicket(proj)} />
                    </>
                  )}
                  {jchStatus[proj]?.state === 'created' && s !== STATUS.ERROR && (
                    <div style={{ marginTop: 6 }}><JchFallbackBanner projectKey={proj} errorDetail={versionErrors[proj]} jchState={jchStatus[proj]} onFileJch={() => handleCreateJchTicket(proj)} /></div>
                  )}
                  {(s === STATUS.CREATED || s === STATUS.EXISTS) && versionErrors[proj] && (
                    <div style={{ color: '#dc3545', fontSize: '0.72rem', marginTop: 4 }}>{versionErrors[proj]}</div>
                  )}
                </div>
              );
            })}
          </div>
          {hasMissingVersions && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={handleBulkCreateVersions}
                disabled={selectedVersionCount === 0 || bulkVersionsRunning}
                style={{ padding: '8px 18px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: 4, cursor: selectedVersionCount === 0 || bulkVersionsRunning ? 'not-allowed' : 'pointer', opacity: selectedVersionCount === 0 || bulkVersionsRunning ? 0.6 : 1, fontSize: '0.85rem', fontWeight: 600 }}
              >
                {bulkVersionsRunning ? 'Creating…' : `Create Selected (${selectedVersionCount})`}
              </button>
              <span style={{ fontSize: '0.78rem', color: '#666' }}>Filters don’t need project admin — you can create them even if versions need JCH.</span>
            </div>
          )}

          {/* Saved Filters checklist — bulk + collapsed JQL */}
          <div style={{ ...sectionHeading, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Saved Filters {missingFilterCount ? `· ${missingFilterCount} missing` : ''}</span>
            {hasMissingFilters && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={missingFilterCount > 0 && selectedFilterCount === missingFilterCount}
                  onChange={e => {
                    const checked = e.target.checked;
                    const next = {};
                    filterChain.forEach(f => {
                      if (filterStatuses[f.name] === STATUS.MISSING || filterStatuses[f.name] === STATUS.ERROR) next[f.name] = checked;
                    });
                    setSelectedFilters(next);
                  }}
                />
                Select all
              </label>
            )}
          </div>
          {releaseProjects.some(p => versionStatuses[p] === STATUS.ERROR || versionStatuses[p] === STATUS.MISSING) && hasMissingFilters && (
            <div style={{ fontSize: '0.78rem', color: '#856404', background: '#fff3cd', padding: '6px 10px', borderRadius: 4, marginBottom: 8 }}>
              Filters create as JIRA saved filters — no project admin needed. You can create them even if some fixVersions need JCH.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filterChain.map((f, idx) => {
              const s = filterStatuses[f.name];
              const selectable = s === STATUS.MISSING || s === STATUS.ERROR;
              const edits = filterEdits[f.name] || {};
              const depsMet = f.dependsOn.every(dep => {
                const depStatus = filterStatuses[dep];
                return depStatus === STATUS.EXISTS || depStatus === STATUS.CREATED;
              });
              const depsSkipped = f.dependsOn.some(dep => filterStatuses[dep] === STATUS.SKIPPED);
              const depsFailed = f.dependsOn.some(dep => filterStatuses[dep] === STATUS.ERROR);
              return (
                <div key={f.name} style={{
                  ...cardStyle,
                  marginBottom: 0,
                  borderLeft: `4px solid ${statusColor(s)}`,
                  opacity: s === STATUS.SKIPPED ? 0.6 : 1,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: selectable ? 'pointer' : 'default', minWidth: 0, flex: 1 }}>
                      <input type="checkbox" disabled={!selectable} checked={!!selectedFilters[f.name]} onChange={e => setSelectedFilters(prev => ({ ...prev, [f.name]: e.target.checked }))} style={{ cursor: selectable ? 'pointer' : 'not-allowed' }} />
                      <span style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>{idx + 1}.</strong> {f.name}
                      </span>
                    </label>
                    <span style={{ color: statusColor(s), fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {statusIcon(s)} {statusLabel(s)}
                    </span>
                  </div>
                  {f.dependsOn.length > 0 && (
                    <div style={{ fontSize: '0.75rem', marginTop: 6, padding: '5px 8px', background: '#f8f9fa', borderRadius: 4 }}>
                      <span style={{ color: '#666' }}>Depends on: </span>
                      {f.dependsOn.map(dep => {
                        const ds = filterStatuses[dep];
                        return (
                          <span key={dep} style={{ marginRight: 6, color: statusColor(ds), fontWeight: 500, fontSize: '0.72rem' }}>
                            {statusIcon(ds)} {dep}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {(depsSkipped || depsFailed) && !depsMet && (
                    <div style={{ color: '#856404', background: '#fff3cd', padding: '6px 8px', borderRadius: 4, fontSize: '0.75rem', marginTop: 6 }}>
                      Warning: dependencies skipped/failed. Creating this filter may error in JIRA.
                    </div>
                  )}
                  {selectable && (
                    <details style={{ marginTop: 8, fontSize: '0.78rem' }}>
                      <summary style={{ cursor: 'pointer', color: '#007bff' }}>Edit JQL</summary>
                      <div style={{ marginTop: 8 }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: 3, color: '#555' }}>Filter Name</label>
                        <input type="text" value={edits.name ?? f.name} onChange={e => handleFilterEdit(f.name, 'name', e.target.value)} style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.82rem', marginBottom: 8, fontFamily: 'monospace' }} />
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: 3, color: '#555' }}>JQL</label>
                        <textarea value={edits.jql ?? f.jql} onChange={e => handleFilterEdit(f.name, 'jql', e.target.value)} rows={Math.max(3, Math.ceil((edits.jql || f.jql).length / 80))} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem', fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical', marginBottom: 6 }} />
                      </div>
                    </details>
                  )}
                  {filterErrors[f.name] && (
                    <div style={{ color: '#dc3545', fontSize: '0.75rem', marginTop: 6, wordBreak: 'break-word' }}>{filterErrors[f.name]}</div>
                  )}
                  {selectable && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => handleCreateFilter(f)} disabled={s === STATUS.CREATING} style={{ padding: '5px 10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: 4, cursor: s === STATUS.CREATING ? 'not-allowed' : 'pointer', opacity: s === STATUS.CREATING ? 0.6 : 1, fontSize: '0.75rem' }}>{s === STATUS.CREATING ? 'Creating…' : s === STATUS.ERROR ? 'Retry' : 'Create'}</button>
                      <button onClick={() => handleSkipFilter(f)} disabled={s === STATUS.CREATING} style={{ padding: '5px 10px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}>Skip</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {hasMissingFilters && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={handleBulkCreateFilters}
                disabled={selectedFilterCount === 0 || bulkFiltersRunning}
                style={{ padding: '8px 18px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: 4, cursor: selectedFilterCount === 0 || bulkFiltersRunning ? 'not-allowed' : 'pointer', opacity: selectedFilterCount === 0 || bulkFiltersRunning ? 0.6 : 1, fontSize: '0.85rem', fontWeight: 600 }}
              >
                {bulkFiltersRunning ? 'Creating…' : `Create Selected Filters (${selectedFilterCount})`}
              </button>
              <span style={{ fontSize: '0.78rem', color: '#666' }}>Selected filters will be created in dependency order.</span>
            </div>
          )}
          {/* Companion tickets — LBDR×2, LEG×1, TECHPUBS×2, SDL×1 — highlight gaps if release exists but tickets missing */}
          {companionTickets.length > 0 && (
            <>
              {(!hasMissingVersions && !hasMissingFilters && hasMissingCompanion) && (
                <div style={{ ...cardStyle, background: '#fff3cd', borderColor: '#ffc107', marginTop: 16 }}>
                  <strong style={{ color: '#856404' }}>Gap: release exists but {missingCompanionCount} default companion ticket{missingCompanionCount > 1 ? 's are' : ' is'} missing.</strong>
                  <span style={{ color: '#856404', marginLeft: 8 }}>Create them now to complete the release.</span>
                </div>
              )}
              <div style={{ ...sectionHeading, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                <span>Companion Tickets {missingCompanionCount ? `· ${missingCompanionCount} missing` : '· all present'}</span>
                {hasMissingCompanion && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer' }}>
                    <input type="checkbox" checked={missingCompanionCount > 0 && selectedCompanionCount === missingCompanionCount} onChange={e => { const checked = e.target.checked; const next = {}; companionTickets.forEach(t => { if (companionStatuses[t.id] === STATUS.MISSING) next[t.id] = checked; }); setSelectedCompanion(next); }} />
                    Select all
                  </label>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {companionTickets.map(t => {
                  const s = companionStatuses[t.id];
                  const selectable = s === STATUS.MISSING;
                  return (
                    <div key={t.id} style={{ ...cardStyle, marginBottom: 0, borderLeft: `4px solid ${statusColor(s)}`, opacity: s === STATUS.SKIPPED ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: selectable ? 'pointer' : 'default', minWidth: 0, flex: 1 }}>
                          <input type="checkbox" disabled={!selectable} checked={!!selectedCompanion[t.id]} onChange={e => setSelectedCompanion(prev => ({ ...prev, [t.id]: e.target.checked }))} style={{ cursor: selectable ? 'pointer' : 'not-allowed' }} />
                          <span style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <strong>{t.projectKey}</strong> — {t.summary} {t.isSecurity || t.priority === 'High' ? <span style={{ background: '#dc3545', color: '#fff', fontSize: '0.65rem', padding: '1px 5px', borderRadius: 3, marginLeft: 4 }}>Security</span> : null}
                          </span>
                        </label>
                        <span style={{ color: statusColor(s), fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {statusIcon(s)} {statusLabel(s)}{t.issueKey ? ` ${t.issueKey}` : ''}
                        </span>
                      </div>
                      {t.exists && t.issueKey && (
                        <div style={{ fontSize: '0.75rem', marginTop: 4 }}><a href={`https://jira.nutanix.com/browse/${t.issueKey}`} target="_blank" rel="noreferrer" style={{ color: '#007bff' }}>{t.issueKey}</a> {t.status ? `· ${t.status}` : ''}</div>
                      )}
                      {companionErrors[t.id] && <div style={{ color: '#dc3545', fontSize: '0.75rem', marginTop: 6 }}>{companionErrors[t.id]}</div>}
                      {selectable && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button onClick={() => handleCreateCompanionOne(t.id)} disabled={s === STATUS.CREATING} style={{ padding: '5px 10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: 4, cursor: s === STATUS.CREATING ? 'not-allowed' : 'pointer', opacity: s === STATUS.CREATING ? 0.6 : 1, fontSize: '0.75rem' }}>{s === STATUS.CREATING ? 'Creating…' : 'Create'}</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {hasMissingCompanion && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={handleBulkCreateCompanion} disabled={selectedCompanionCount === 0 || bulkCompanionRunning} style={{ padding: '8px 18px', backgroundColor: '#6f42c1', color: '#fff', border: 'none', borderRadius: 4, cursor: selectedCompanionCount === 0 || bulkCompanionRunning ? 'not-allowed' : 'pointer', opacity: selectedCompanionCount === 0 || bulkCompanionRunning ? 0.6 : 1, fontSize: '0.85rem', fontWeight: 600 }}>
                    {bulkCompanionRunning ? 'Creating…' : `Create Selected Companion Tickets (${selectedCompanionCount})`}
                  </button>
                  <span style={{ fontSize: '0.78rem', color: '#666' }}>Each creates a Task with fixVersion = {version}.</span>
                </div>
              )}
              {companionErrors._bulk && <div style={{ color: '#dc3545', fontSize: '0.8rem', marginTop: 6 }}>{companionErrors._bulk}</div>}
            </>
          )}

          {phase === 'checked' && !hasMissingVersions && !hasMissingFilters && !hasMissingCompanion && !everythingExists && (
            <div style={{ ...cardStyle, background: '#d4edda', borderColor: '#28a745', marginTop: 12 }}>
              <strong style={{ color: '#155724' }}>All processed.</strong>
              <span style={{ color: '#155724', marginLeft: 8 }}>No more missing versions, filters or companion tickets for {version}.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CreateRelease;
