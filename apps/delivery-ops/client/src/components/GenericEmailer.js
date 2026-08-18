import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { authenticatedPost, authenticatedGet, authenticatedPut, authenticatedDelete } from '../utils/api';
import { useGenericEmailerConfig } from '../hooks/useGenericEmailerConfig';
import { formatters } from '../shared/utils/formatters';
import OutlookFallback from './shared/OutlookFallback';
import './GenericEmailer.css';

const username = () => localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
const jiraToken = () => localStorage.getItem('jiraToken') || '';

const COLUMN_ORDER_STORAGE_KEY = 'genericEmailer_columnOrder';
const DESELECTED_COLUMNS_STORAGE_KEY = 'genericEmailer_deselectedColumns';
function getColumnOrderStorageKey() {
  const u = username();
  return u ? `${COLUMN_ORDER_STORAGE_KEY}_${u}` : COLUMN_ORDER_STORAGE_KEY;
}
function getDeselectedStorageKey() {
  const u = username();
  return u ? `${DESELECTED_COLUMNS_STORAGE_KEY}_${u}` : DESELECTED_COLUMNS_STORAGE_KEY;
}
function getSavedColumnOrder() {
  try {
    const raw = localStorage.getItem(getColumnOrderStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function getSavedDeselectedFieldIds() {
  try {
    const raw = localStorage.getItem(getDeselectedStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveColumnOrder(order) {
  if (!Array.isArray(order) || order.length === 0) return;
  try {
    localStorage.setItem(getColumnOrderStorageKey(), JSON.stringify(order));
  } catch (_) {}
}
function saveDeselectedFieldIds(ids) {
  if (!Array.isArray(ids)) return;
  try {
    localStorage.setItem(getDeselectedStorageKey(), JSON.stringify(ids));
  } catch (_) {}
}

function GenericEmailer() {
  const [jql, setJql] = useState('');
  const [issues, setIssues] = useState([]);
  const [fieldsWithData, setFieldsWithData] = useState([]);
  const [selectedFieldIdsInOrder, setSelectedFieldIdsInOrder] = useState([]);
  const [toRecipients, setToRecipients] = useState('');
  const [projectTeamChecked, setProjectTeamChecked] = useState({});
  const [optionalCCChecked, setOptionalCCChecked] = useState({});
  const [subject, setSubject] = useState('');
  const [fetching, setFetching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { config: fetchedEmailerConfig } = useGenericEmailerConfig();
  const [genericEmailerConfig, setGenericEmailerConfig] = useState({ projectTeamFields: [], optionalCCRecipients: [] });
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(20);
  const [notes, setNotes] = useState('');
  const [dragOrderIndex, setDragOrderIndex] = useState(null);
  const jqlRef = useRef(null);
  const [schedules, setSchedules] = useState([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1);
  const [scheduleHour, setScheduleHour] = useState(9);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [scheduleTimezone, setScheduleTimezone] = useState('America/Los_Angeles');
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const quillModules = {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean']
    ]
  };

  useEffect(() => {
    if (!fetchedEmailerConfig) return;
    setGenericEmailerConfig(fetchedEmailerConfig);
    const teamInitial = {};
    (fetchedEmailerConfig.projectTeamFields || []).forEach(f => { teamInitial[f.id] = false; });
    setProjectTeamChecked(teamInitial);
    const ccInitial = {};
    (fetchedEmailerConfig.optionalCCRecipients || []).forEach((_, i) => { ccInitial[String(i)] = false; });
    setOptionalCCChecked(ccInitial);
  }, [fetchedEmailerConfig]);

  const defaultSubject = () => {
    const d = new Date();
    return `NDB Reminder – ${formatters.date(d) || d.toISOString().slice(0, 10)}`;
  };

  const handleFetch = async () => {
    if (!jql.trim()) {
      setError('Enter a JQL query');
      return;
    }
    setError('');
    setSuccess('');
    setFetching(true);
    try {
      const res = await authenticatedPost('/api/jira/search-by-jql', { jql: jql.trim(), maxResults: 500 }, { jiraToken: jiraToken(), username: username() });
      const fields = res.data.fieldsWithData || [];
      setIssues(res.data.issues || []);
      setFieldsWithData(fields);
      setPreviewPage(1);
      const fieldIds = fields.map(f => f.id);
      const defaultIds = ['key', 'summary', 'assignee', 'customfield_10860', 'priority'];
      const savedOrder = getSavedColumnOrder();
      const deselectedIds = getSavedDeselectedFieldIds();
      let order;
      if (savedOrder && savedOrder.length > 0) {
        const filteredSaved = savedOrder.filter(id => fieldIds.includes(id));
        const newIds = fieldIds.filter(id => !filteredSaved.includes(id) && !deselectedIds.includes(id));
        order = filteredSaved.length > 0 ? [...filteredSaved, ...newIds] : defaultIds.filter(id => fieldIds.includes(id) && !deselectedIds.includes(id));
      } else {
        order = defaultIds.filter(id => fieldIds.includes(id) && !deselectedIds.includes(id));
      }
      setSelectedFieldIdsInOrder(order);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to fetch issues');
      setIssues([]);
      setFieldsWithData([]);
    } finally {
      setFetching(false);
    }
  };

  const toggleField = (fieldId) => {
    setSelectedFieldIdsInOrder(prev => {
      if (prev.includes(fieldId)) {
        const next = prev.filter(id => id !== fieldId);
        saveDeselectedFieldIds([...getSavedDeselectedFieldIds(), fieldId]);
        return next;
      }
        const next = [...prev, fieldId];
        saveDeselectedFieldIds(getSavedDeselectedFieldIds().filter(id => id !== fieldId));
        return next;
    });
  };

  const moveField = (index, direction) => {
    const newOrder = [...selectedFieldIdsInOrder];
    const target = index + direction;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setSelectedFieldIdsInOrder(newOrder);
  };

  const removeFromOrder = (fieldId) => {
    saveDeselectedFieldIds([...getSavedDeselectedFieldIds(), fieldId]);
    setSelectedFieldIdsInOrder(prev => prev.filter(id => id !== fieldId));
  };

  const handleOrderDragStart = (e, index) => {
    setDragOrderIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleOrderDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleOrderDrop = (e, dropIndex) => {
    e.preventDefault();
    const dragIndex = dragOrderIndex;
    setDragOrderIndex(null);
    if (dragIndex == null || dragIndex === dropIndex) return;
    const newOrder = [...selectedFieldIdsInOrder];
    const [removed] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setSelectedFieldIdsInOrder(newOrder);
  };

  const handleOrderDragEnd = () => {
    setDragOrderIndex(null);
  };

  const handleProjectTeamChange = (fieldId) => {
    setProjectTeamChecked(prev => ({ ...prev, [fieldId]: !prev[fieldId] }));
  };

  const handleOptionalCCChange = (key) => {
    setOptionalCCChecked(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const res = await authenticatedGet('/api/email/schedules', {}, { jiraToken: jiraToken(), username: username() });
      setSchedules(res.data.schedules || []);
    } catch (_) {
      setSchedules([]);
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const handleSaveSchedule = async () => {
    if (!jql.trim()) {
      setScheduleError('Enter a JQL query first');
      return;
    }
    if (selectedFieldIdsInOrder.length === 0) {
      setScheduleError('Select at least one column');
      return;
    }
    setScheduleError('');
    setScheduleSuccess('');
    setSavingSchedule(true);
    const includeProjectTeam = Object.keys(projectTeamChecked).filter(id => projectTeamChecked[id]);
    const selectedCCRecipients = (genericEmailerConfig.optionalCCRecipients || [])
      .filter((_, i) => optionalCCChecked[String(i)]);
    try {
      await authenticatedPost('/api/email/schedules', {
        name: scheduleName.trim() || jql.slice(0, 40),
        jql: jql.trim(),
        selectedFieldIds: selectedFieldIdsInOrder,
        toRecipients: toRecipients.trim() || undefined,
        includeProjectTeam,
        selectedCCRecipients,
        subject: subject.trim() || defaultSubject(),
        notes: notes.trim() || undefined,
        schedule: {
          dayOfWeek: scheduleDayOfWeek,
          hour: scheduleHour,
          minute: scheduleMinute,
          timezone: scheduleTimezone
        },
        enabled: true
      }, { jiraToken: jiraToken(), username: username() });
      setScheduleSuccess('Schedule saved. Email will run at the set day and time.');
      setShowScheduleForm(false);
      fetchSchedules();
    } catch (err) {
      setScheduleError(err.response?.data?.error || err.message || 'Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleToggleSchedule = async (schedule) => {
    try {
      await authenticatedPut(`/api/email/schedules/${schedule.id}`, { enabled: !schedule.enabled }, { jiraToken: jiraToken(), username: username() });
      fetchSchedules();
    } catch (_) {
      setScheduleError('Failed to update schedule');
    }
  };

  const handleDeleteSchedule = async (id) => {
    if (!window.confirm('Delete this scheduled email?')) return;
    try {
      await authenticatedDelete(`/api/email/schedules/${id}`, {}, { jiraToken: jiraToken(), username: username() });
      fetchSchedules();
    } catch (_) {
      setScheduleError('Failed to delete schedule');
    }
  };

  // Persist column order when user changes selection or order
  useEffect(() => {
    if (selectedFieldIdsInOrder.length > 0) saveColumnOrder(selectedFieldIdsInOrder);
  }, [selectedFieldIdsInOrder]);

  // Auto-resize JQL textarea: start as one line, grow with content
  useEffect(() => {
    const el = jqlRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(40, Math.min(el.scrollHeight, 400))}px`;
  }, [jql]);

  const handleSend = async () => {
    if (selectedFieldIdsInOrder.length === 0) {
      setError('Select at least one column for the email');
      return;
    }
    setError('');
    setSuccess('');
    setSending(true);
    const fieldLabels = {};
    fieldsWithData.forEach(f => { fieldLabels[f.id] = f.label; });
    const includeProjectTeam = Object.keys(projectTeamChecked).filter(id => projectTeamChecked[id]);
    const optionalCCRecipients = (genericEmailerConfig.optionalCCRecipients || [])
      .filter((_, i) => optionalCCChecked[String(i)]);
    try {
      await authenticatedPost('/api/email/send-generic-reminder', {
        selectedFieldIdsInOrder,
        issuesPayload: issues,
        toRecipients: toRecipients.trim() || undefined,
        includeProjectTeam,
        selectedCCRecipients: optionalCCRecipients,
        subject: subject.trim() || defaultSubject(),
        fieldLabels,
        notes: notes.trim() || undefined
      }, { jiraToken: jiraToken(), username: username() });
      setSuccess('Email sent successfully.');
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const formatCell = (raw) => {
    if (raw == null || raw === undefined) return 'N/A';
    if (typeof raw === 'string') return raw.trim() === '' ? 'N/A' : raw;
    if (Array.isArray(raw)) {
      const parts = raw.map(formatCell).filter(x => x !== 'N/A' && x !== '');
      return parts.length === 0 ? 'N/A' : parts.join(', ');
    }
    if (typeof raw === 'object') {
      if (raw.displayName || raw.name || raw.emailAddress || raw.email || raw.key) {
        const v = raw.displayName || raw.name || raw.emailAddress || raw.email || raw.key;
        return (v && String(v).trim()) ? v : 'N/A';
      }
      if (raw.value != null) return formatCell(raw.value);
      if (raw.name != null) return formatCell(raw.name);
      if (raw.key) return raw.key;
    }
    const s = String(raw);
    return s.trim() === '' ? 'N/A' : s;
  };

  return (
    <div className="generic-emailer">
      <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>JIRA Emailer (Reminder)</h2>

      <section className="generic-emailer-section" style={{ marginBottom: '1.5rem' }}>
        <div className="grid-container">
          <div className="grid-9">
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>JQL</label>
            <textarea
              ref={jqlRef}
              value={jql}
              onChange={e => { setJql(e.target.value); setError(''); }}
              placeholder="e.g. project = ERA AND status != Done"
              rows={1}
              style={{
                width: '100%',
                minHeight: '40px',
                maxHeight: '400px',
                padding: '0.75rem',
                fontSize: '0.95rem',
                fontFamily: 'ui-monospace, monospace',
                lineHeight: 1.4,
                resize: 'none',
                overflowY: 'auto'
              }}
            />
          </div>
          <div className="grid-3" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleFetch} disabled={fetching} style={{ padding: '0.5rem 1rem' }}>
              {fetching ? 'Fetching...' : 'Fetch'}
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || issues.length === 0 || selectedFieldIdsInOrder.length === 0}
              title={issues.length === 0 ? 'Fetch issues first before sending' : selectedFieldIdsInOrder.length === 0 ? 'Select at least one column' : 'Send email'}
              style={{ padding: '0.5rem 1rem' }}
            >
              {sending ? 'Sending...' : 'Send Email'}
            </button>
            <OutlookFallback
              buttonLabel="Copy Email to Clipboard"
              htmlBody={notes || ''}
            />
          </div>
        </div>
      </section>

      {issues.length === 0 && !fetching && jql.trim() === '' && (
        <div style={{ color: '#718096', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Enter a JQL query and click <strong>Fetch</strong> to load issues, then click <strong>Send Email</strong>.
        </div>
      )}
      {issues.length === 0 && !fetching && jql.trim() !== '' && (
        <div style={{ color: '#718096', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Click <strong>Fetch</strong> to load issues before sending.
        </div>
      )}
      {error && <div className="generic-emailer-error" style={{ color: '#c53030', marginBottom: '1rem' }}>{error}</div>}
      {success && <div className="generic-emailer-success" style={{ color: '#276749', marginBottom: '1rem' }}>{success}</div>}

      <section className="generic-emailer-section" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Subject and body</h3>
        <div className="grid-container">
          <div className="grid-12">
            <label style={{ display: 'block', marginBottom: '0.35rem' }}>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={defaultSubject()}
              style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem' }}
            />
            <label style={{ display: 'block', marginBottom: '0.35rem' }}>Body (included in email above the table)</label>
            <div className="generic-emailer-body-editor">
              <ReactQuill
                value={notes}
                onChange={setNotes}
                modules={quillModules}
                placeholder="Add email body text (optional). Use the toolbar for formatting."
                className="rich-text-editor generic-emailer-body-quill"
              />
            </div>
          </div>
        </div>
      </section>

      {fieldsWithData.length > 0 && (
        <>
          <section className="generic-emailer-section" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Columns (select and reorder for email)</h3>
            <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>Only columns that have at least one value in the fetched tickets are shown. Key, Summary, Assignee, QA Contact, and Priority are selected by default. Uncheck to remove. Use Up/Down to set order. Empty cells show N/A.</p>
            <div className="grid-container">
              <div className="grid-12">
                <div className="generic-emailer-fields-list generic-emailer-columns-grid">
              {fieldsWithData.map(f => (
                <label key={f.id} htmlFor={`field-${f.id}`} className="generic-emailer-column-item">
                  <input
                    type="checkbox"
                    id={`field-${f.id}`}
                    checked={selectedFieldIdsInOrder.includes(f.id)}
                    onChange={() => toggleField(f.id)}
                  />
                  <span className="generic-emailer-column-label">{f.label}</span>
                </label>
              ))}
                </div>
              </div>
            </div>
            {selectedFieldIdsInOrder.length > 0 && (
              <div className="generic-emailer-order" style={{ marginTop: '1rem' }}>
                <strong>Order (for email):</strong>
                <p style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem', marginBottom: '0.35rem' }}>Drag to reorder, or use Up/Down. Click × to remove from email.</p>
                <ul style={{ listStyle: 'none', paddingLeft: 0, marginTop: '0.35rem' }}>
                  {selectedFieldIdsInOrder.map((id, index) => {
                    const label = fieldsWithData.find(f => f.id === id)?.label || id;
                    return (
                      <li
                        key={id}
                        draggable
                        onDragStart={(e) => handleOrderDragStart(e, index)}
                        onDragOver={handleOrderDragOver}
                        onDrop={(e) => handleOrderDrop(e, index)}
                        onDragEnd={handleOrderDragEnd}
                        className={`generic-emailer-order-item${dragOrderIndex === index ? ' is-dragging' : ''}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          marginBottom: '0.25rem',
                          padding: '0.25rem 0.5rem',
                          background: dragOrderIndex === index ? '#e8f4fc' : 'transparent',
                          borderRadius: '4px'
                        }}
                      >
                        <span style={{ color: '#666' }} title="Drag to reorder">⋮⋮</span>
                        <button type="button" onClick={() => moveField(index, -1)} disabled={index === 0} style={{ padding: '2px 6px' }}>Up</button>
                        <button type="button" onClick={() => moveField(index, 1)} disabled={index === selectedFieldIdsInOrder.length - 1} style={{ padding: '2px 6px' }}>Down</button>
                        <span style={{ flex: 1 }}>{label}</span>
                        <button
                          type="button"
                          onClick={() => removeFromOrder(id)}
                          title="Remove from email"
                          style={{ padding: '2px 6px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', background: 'none', border: 'none' }}
                          aria-label={`Remove ${label} from email`}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          <section className="generic-emailer-section" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Recipients</h3>
            <div className="grid-container">
              <div className="grid-12">
                <label style={{ display: 'block', marginBottom: '0.35rem' }}>To (optional; comma or semicolon separated)</label>
                <input
                  type="text"
                  value={toRecipients}
                  onChange={e => setToRecipients(e.target.value)}
                  placeholder="user@nutanix.com, username"
                  style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem' }}
                />
              </div>
              {(genericEmailerConfig.optionalCCRecipients || []).length > 0 && (
                <div className="grid-6">
                  <strong>CC (optional – select to add to CC):</strong>
                  <div
                    className="generic-emailer-optional-cc"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '0.25rem 2rem',
                      marginTop: '0.35rem'
                    }}
                  >
                    {(genericEmailerConfig.optionalCCRecipients || []).map((name, i) => (
                      <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={optionalCCChecked[String(i)] || false}
                          onChange={() => handleOptionalCCChange(String(i))}
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className={genericEmailerConfig.optionalCCRecipients?.length ? 'grid-6' : 'grid-12'}>
                <strong>Project team (CC):</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.25rem 1rem', marginTop: '0.35rem' }}>
                  {(genericEmailerConfig.projectTeamFields || []).map(f => (
                    <label key={f.id} htmlFor={`project-team-${f.id}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                      <input
                        type="checkbox"
                        id={`project-team-${f.id}`}
                        checked={projectTeamChecked[f.id] || false}
                        onChange={() => handleProjectTeamChange(f.id)}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="generic-emailer-section" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Scheduled emails</h3>
            <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>Save this query and column setup to send automatically on a chosen day and time. Set JIRA_SCHEDULED_EMAIL_TOKEN and JIRA_SCHEDULED_EMAIL_USER on the server for scheduled sends to run.</p>
            {scheduleError && <div style={{ color: '#c53030', marginBottom: '0.5rem' }}>{scheduleError}</div>}
            {scheduleSuccess && <div style={{ color: '#276749', marginBottom: '0.5rem' }}>{scheduleSuccess}</div>}
            {!showScheduleForm ? (
              <button type="button" onClick={() => setShowScheduleForm(true)} style={{ padding: '0.5rem 1rem' }}>
                Save as scheduled email
              </button>
            ) : (
              <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', maxWidth: '400px' }}>
                <label style={{ display: 'block', marginBottom: '0.35rem' }}>Name (optional)</label>
                <input type="text" value={scheduleName} onChange={e => setScheduleName(e.target.value)} placeholder="e.g. ERA weekly reminder" style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem' }} />
                <label style={{ display: 'block', marginBottom: '0.35rem' }}>Day of week</label>
                <select value={scheduleDayOfWeek} onChange={e => setScheduleDayOfWeek(Number(e.target.value))} style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem' }}>
                  {[{ v: 0, l: 'Sunday' }, { v: 1, l: 'Monday' }, { v: 2, l: 'Tuesday' }, { v: 3, l: 'Wednesday' }, { v: 4, l: 'Thursday' }, { v: 5, l: 'Friday' }, { v: 6, l: 'Saturday' }].map(({ v, l }) => <option key={v} value={v}>{l}</option>)}
                </select>
                <label style={{ display: 'block', marginBottom: '0.35rem' }}>Time (hour : minute)</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <select value={scheduleHour} onChange={e => setScheduleHour(Number(e.target.value))} style={{ padding: '0.5rem' }}>
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                  </select>
                  <span>:</span>
                  <select value={scheduleMinute} onChange={e => setScheduleMinute(Number(e.target.value))} style={{ padding: '0.5rem' }}>
                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                  </select>
                </div>
                <label style={{ display: 'block', marginBottom: '0.35rem' }}>Timezone</label>
                <input type="text" value={scheduleTimezone} onChange={e => setScheduleTimezone(e.target.value)} placeholder="America/Los_Angeles" style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem' }} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={handleSaveSchedule} disabled={savingSchedule} style={{ padding: '0.5rem 1rem' }}>{savingSchedule ? 'Saving...' : 'Save schedule'}</button>
                  <button type="button" onClick={() => setShowScheduleForm(false)} style={{ padding: '0.5rem 1rem' }}>Cancel</button>
                </div>
              </div>
            )}
            {loadingSchedules ? <p style={{ marginTop: '1rem', color: '#666' }}>Loading schedules...</p> : schedules.length > 0 && (
              <ul style={{ listStyle: 'none', paddingLeft: 0, marginTop: '1rem' }}>
                {schedules.map(s => (
                  <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', padding: '0.5rem', background: '#f9f9f9', borderRadius: '4px' }}>
                    <span style={{ flex: 1 }}>{s.name || s.jql?.slice(0, 50) || s.id}</span>
                    <span style={{ fontSize: '0.85rem', color: '#555' }}>
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.schedule?.dayOfWeek ?? 1]} {String(s.schedule?.hour ?? 9).padStart(2, '0')}:{String(s.schedule?.minute ?? 0).padStart(2, '0')} {s.schedule?.timezone || ''}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                      <input type="checkbox" checked={!!s.enabled} onChange={() => handleToggleSchedule(s)} />
                      <span style={{ fontSize: '0.85rem' }}>On</span>
                    </label>
                    <button type="button" onClick={() => handleDeleteSchedule(s.id)} style={{ padding: '0.25rem 0.5rem', color: '#c53030', fontSize: '0.85rem' }}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedFieldIdsInOrder.length > 0 && issues.length > 0 && (() => {
            const totalPages = Math.max(1, Math.ceil(issues.length / previewPageSize));
            const start = (previewPage - 1) * previewPageSize;
            const pageIssues = issues.slice(start, start + previewPageSize);
            return (
              <section className="generic-emailer-section" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Preview</h3>
                <div className="grid-container">
                  <div className="grid-12">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.9rem', color: '#555' }}>
                    {issues.length} row{issues.length !== 1 ? 's' : ''}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem', margin: 0 }}>
                    Rows per page:
                    <select
                      value={previewPageSize}
                      onChange={e => { setPreviewPageSize(Number(e.target.value)); setPreviewPage(1); }}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      {[10, 20, 50, 100].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
                    <thead>
                      <tr>
                        {selectedFieldIdsInOrder.map(id => (
                          <th key={id} style={{ border: '1px solid #ddd', padding: '6px 8px', textAlign: 'left', background: '#f5f5f5' }}>
                            {fieldsWithData.find(f => f.id === id)?.label || id}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageIssues.map((issue, i) => (
                        <tr key={issue.key || i}>
                          {selectedFieldIdsInOrder.map(fid => (
                            <td key={fid} style={{ border: '1px solid #ddd', padding: '6px 8px' }}>
                              {formatCell(fid === 'key' ? issue.key : issue[fid])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                    disabled={previewPage <= 1}
                    style={{ padding: '0.35rem 0.75rem' }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: '0.9rem' }}>
                    Page {previewPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))}
                    disabled={previewPage >= totalPages}
                    style={{ padding: '0.35rem 0.75rem' }}
                  >
                    Next
                  </button>
                </div>
                  </div>
                </div>
              </section>
            );
          })()}
        </>
      )}

      {issues.length > 0 && fieldsWithData.length === 0 && <p style={{ color: '#666' }}>No fields with data in this result set.</p>}
    </div>
  );
}

export default GenericEmailer;
