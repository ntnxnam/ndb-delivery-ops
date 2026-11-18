import React, { useMemo, useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { authenticatedGet } from '../../shared/services/apiService';
import {
  buildGateVsActualRows,
  maxCompareDays,
  resolvePrimaryFixVersion,
  resolveReleaseGaDate,
  resolveReleaseCcDate,
} from './gateDateUtils';

/**
 * Dual waterfall timeline: Prescribed vs Actual.
 * Code Complete: Prescribed = EC→release CC + ticket CC; Actual = coding start→end.
 */
function GateDatesBarChart({ jiraData, workItems }) {
  const [ecDate, setEcDate] = useState(null);
  const [gaDate, setGaDate] = useState(null);
  const [ccDate, setCcDate] = useState(null);
  const [ecLoading, setEcLoading] = useState(false);
  const [ecError, setEcError] = useState('');

  const fixVersion = useMemo(() => resolvePrimaryFixVersion(jiraData), [jiraData]);

  useEffect(() => {
    let cancelled = false;
    if (!fixVersion) {
      setEcDate(null);
      setGaDate(null);
      setCcDate(null);
      setEcError('');
      return undefined;
    }

    setEcLoading(true);
    setEcError('');
    authenticatedGet('/api/config/release-versions')
      .then((resp) => {
        if (cancelled) return;
        const cfg = resp.data?.releaseGateDates?.[fixVersion];
        const ec = cfg?.ecDate || null;
        setEcDate(ec);
        setGaDate(resolveReleaseGaDate(cfg));
        setCcDate(resolveReleaseCcDate(cfg));
        if (!ec) setEcError(`No EC date in release config for ${fixVersion}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setEcDate(null);
        setGaDate(null);
        setCcDate(null);
        setEcError(err.message || 'Failed to load EC date');
      })
      .finally(() => {
        if (!cancelled) setEcLoading(false);
      });

    return () => { cancelled = true; };
  }, [fixVersion]);

  const compare = useMemo(
    () => buildGateVsActualRows(jiraData, ecDate, gaDate, workItems, ccDate),
    [jiraData, ecDate, gaDate, workItems, ccDate]
  );

  const xMax = useMemo(() => maxCompareDays(compare.rows), [compare.rows]);

  const todayDay = useMemo(() => {
    if (!compare.ecDate) return null;
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return Math.round((t.getTime() - compare.ecDate.getTime()) / 86400000);
  }, [compare.ecDate]);

  const hasTicketSegment = useMemo(
    () => compare.rows.some((r) => r.hasTicketSegment && (r.gateDuration2 || 0) > 0),
    [compare.rows]
  );

  if (!jiraData) return null;

  const workItemsReady = Array.isArray(workItems);
  const showToday = todayDay != null && todayDay >= 0 && todayDay <= xMax;

  return (
    <div className="form-group" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
      <label style={{ marginBottom: '0.25rem' }}>
        Gates vs Actuals
        {compare.ecLabel && compare.ecLabel !== 'Not Set' ? (
          <span style={{ fontWeight: 400, color: '#666' }}>
            {' '}· days from EC {compare.ecLabel}{fixVersion ? ` · ${fixVersion}` : ''}
          </span>
        ) : null}
      </label>
      {ecLoading && (
        <div style={{ fontSize: '0.75rem', color: '#666' }}>Loading EC…</div>
      )}
      {!ecLoading && !ecDate && (
        <div style={{ padding: '6px 8px', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff3cd', fontSize: '0.75rem', fontWeight: 600 }}>
          {ecError || 'No EC in release config — set EC to show the timeline.'}
        </div>
      )}
      {!ecLoading && ecDate && compare.rows.length === 0 && (
        <div style={{ padding: '6px 8px', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff3cd', fontSize: '0.75rem', fontWeight: 600 }}>
          No gate or actual dates to plot yet.
        </div>
      )}
      {!ecLoading && ecDate && compare.rows.length > 0 && (
        <div style={{ border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff', padding: '4px 4px 0' }}>
          <ResponsiveContainer width="100%" height={Math.max(180, compare.rows.length * 30 + 48)}>
            <BarChart
              data={compare.rows}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              barCategoryGap="16%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis
                type="number"
                domain={[0, xMax]}
                tick={{ fontSize: 10 }}
                label={{ value: 'Days from EC →', position: 'insideBottomRight', offset: -2, fontSize: 10, fill: '#888' }}
              />
              <YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value, name, props) => {
                  if (name === 'gateOffset' || name === 'actualOffset') return [null, null];
                  const row = props?.payload;
                  if (!row) return [value, name];
                  if (name === 'Prescribed' || name === 'Ticket CC') {
                    if (!row.gateSet) return ['—', 'Prescribed'];
                    const span = row.gateInverted
                      ? `${Math.abs(row.gateDaySpan)}d inverted`
                      : `${row.gateDaySpan}d`;
                    return [`${row.gateDateLabel} (${span})`, 'Prescribed'];
                  }
                  if (name === 'Actual') {
                    if (!row.actualSet) return ['—', 'Actual'];
                    const span = row.actualInverted
                      ? `${Math.abs(row.actualDaySpan)}d inverted`
                      : `${row.actualDaySpan}d`;
                    const suffix = row.partial ? ' · in progress' : '';
                    return [`${row.actualDateLabel} (${span})${suffix}`, 'Actual'];
                  }
                  return [value, name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                payload={[
                  { value: 'Prescribed', type: 'square', color: '#6c757d', id: 'prescribed' },
                  ...(hasTicketSegment
                    ? [{ value: 'Ticket CC (on Prescribed bar)', type: 'square', color: '#adb5bd', id: 'ticket-cc' }]
                    : []),
                  { value: 'Actual', type: 'square', color: '#1f77b4', id: 'actual' },
                  ...(showToday
                    ? [{ value: 'Today', type: 'line', color: '#dc3545', id: 'today' }]
                    : []),
                ]}
              />
              {showToday && (
                <ReferenceLine x={todayDay} stroke="#dc3545" strokeDasharray="4 3" strokeWidth={1} />
              )}
              <Bar dataKey="gateOffset" stackId="gate" fill="transparent" barSize={10} isAnimationActive={false} legendType="none" />
              <Bar dataKey="gateDuration" name="Prescribed" stackId="gate" barSize={10} radius={[0, 0, 0, 0]}>
                {compare.rows.map((row) => (
                  <Cell
                    key={`g-${row.key}`}
                    fill={row.gateInverted ? '#dc3545' : '#6c757d'}
                  />
                ))}
              </Bar>
              <Bar dataKey="gateDuration2" name="Ticket CC" stackId="gate" barSize={10} radius={[0, 2, 2, 0]} legendType="none">
                {compare.rows.map((row) => (
                  <Cell
                    key={`g2-${row.key}`}
                    fill={row.hasTicketSegment ? (row.gateInverted ? '#e57373' : '#adb5bd') : 'transparent'}
                  />
                ))}
              </Bar>
              <Bar dataKey="actualOffset" stackId="actual" fill="transparent" barSize={10} isAnimationActive={false} legendType="none" />
              <Bar dataKey="actualDuration" name="Actual" stackId="actual" barSize={10} radius={[0, 2, 2, 0]}>
                {compare.rows.map((row) => (
                  <Cell key={`a-${row.key}`} fill={row.actualInverted ? '#dc3545' : '#1f77b4'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: '0.7rem', color: '#888', padding: '2px 6px 4px' }}>
            Prescribed = plan dates · Actual = when work happened · CC Prescribed: EC→release gate + ticket date · CC Actual: first coding start→last coding finish
            {!workItemsReady ? ' · Loading work items…' : ''}
            {compare.notes?.length ? ` · ${compare.notes.join('; ')}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

export default GateDatesBarChart;
