import React, { useMemo, useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { authenticatedGet } from '../../utils/api';
import {
  buildSequentialGateSegments,
  resolvePrimaryFixVersion,
} from './gateDateUtils';

/**
 * Sequential waterfall: EC → FS/DS → Test Plan → CC → CG → PG.
 * Each bar is one leg's duration, offset from EC (not parallel days-from-today).
 */
function GateDatesBarChart({ jiraData }) {
  const [ecDate, setEcDate] = useState(null);
  const [ecLoading, setEcLoading] = useState(false);
  const [ecError, setEcError] = useState('');

  const fixVersion = useMemo(() => resolvePrimaryFixVersion(jiraData), [jiraData]);

  useEffect(() => {
    let cancelled = false;
    if (!fixVersion) {
      setEcDate(null);
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
        if (!ec) setEcError(`No EC date in release config for ${fixVersion}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setEcDate(null);
        setEcError(err.message || 'Failed to load EC date');
      })
      .finally(() => {
        if (!cancelled) setEcLoading(false);
      });

    return () => { cancelled = true; };
  }, [fixVersion]);

  const { ecLabel, segments, missing } = useMemo(
    () => buildSequentialGateSegments(jiraData, ecDate),
    [jiraData, ecDate]
  );

  if (!jiraData) return null;

  return (
    <div className="form-group" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
      <label style={{ marginBottom: '0.25rem' }}>
        Gates
        {ecLabel ? <span style={{ fontWeight: 400, color: '#666' }}> · EC {ecLabel}{fixVersion ? ` · ${fixVersion}` : ''}</span> : null}
      </label>
      {ecLoading && (
        <div style={{ fontSize: '0.75rem', color: '#666' }}>Loading EC…</div>
      )}
      {!ecLoading && !ecDate && (
        <div style={{ padding: '6px 8px', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff3cd', fontSize: '0.75rem', fontWeight: 600 }}>
          {ecError || 'No EC in release config — set EC to show the timeline.'}
        </div>
      )}
      {!ecLoading && ecDate && segments.length === 0 && (
        <div style={{ padding: '6px 8px', border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff3cd', fontSize: '0.75rem', fontWeight: 600 }}>
          No gate dates after EC.
        </div>
      )}
      {!ecLoading && ecDate && segments.length > 0 && (
        <div style={{ border: '1px solid #dee2e6', borderRadius: '4px', background: '#fff', padding: '4px 4px 0' }}>
          <ResponsiveContainer width="100%" height={Math.max(140, segments.length * 28 + 28)}>
            <BarChart
              data={segments}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value, name, props) => {
                  if (name === 'offset') return [null, null];
                  const row = props?.payload;
                  if (!row) return [value, 'days'];
                  const span = row.inverted
                    ? `${Math.abs(row.daySpan)}d (inverted)`
                    : `${row.daySpan}d`;
                  return [`${row.fromDateLabel} → ${row.toDateLabel} (${span})`, 'Duration'];
                }}
              />
              <Bar dataKey="offset" stackId="seq" barSize={12} fill="transparent" isAnimationActive={false} />
              <Bar dataKey="duration" stackId="seq" barSize={12} radius={[0, 2, 2, 0]}>
                {segments.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {missing.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: '#888', padding: '0 6px 4px' }}>
              Skipped: {missing.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GateDatesBarChart;
