import React, { useRef } from 'react';
import { formatters } from '../shared/utils/formatters';

// ── Gate extractors — handles both old and new config field shapes ────────────
function getDate(cfg, key) {
  if (!cfg) return null;
  switch (key) {
    case 'ccReq': return cfg.ccPayloadReqDate || null;
    case 'ec':    return cfg.ecDate || null;
    case 'cc': {
      const slots = [
        ...(cfg.ccm2Gate || []),
        ...(cfg.ccm1Gate || []),
      ].filter(x => x?.date);
      return cfg.codeComplete?.date || slots[slots.length - 1]?.date || null;
    }
    case 'cg': return cfg.commitGate2?.date || cfg.commitGate1?.date || null;
    case 'bc': return cfg.branchCut?.date || null;
    case 'pg': return cfg.promotionGate3?.date || cfg.promotionGate2?.date || cfg.promotionGate1?.date || null;
    case 'ga': return cfg.ga4?.date || cfg.ga3?.date || cfg.ga2?.date || cfg.ga1?.date || null;
    default:   return null;
  }
}

const GATE_KEYS   = ['ccReq', 'ec', 'cc', 'cg', 'bc', 'pg', 'ga'];
const GATE_LABELS = { ccReq: 'CC / Payload Req', ec: 'EC / Commit', cc: 'Code Complete', cg: 'CG / Manual Testing', bc: 'Branch Cut', pg: 'PG / Automation', ga: 'GA' };

const T_START = new Date('2025-11-01');
const T_END   = new Date('2026-12-31');
const SPAN    = (T_END - T_START) / 864e5;

function pct(dateStr) {
  if (!dateStr) return null;
  const days = (new Date(dateStr + 'T00:00:00') - T_START) / 864e5;
  return Math.max(0, Math.min(100, (days / SPAN) * 100));
}

function fmtTip(key, dateStr) {
  if (!dateStr) return '';
  const label = formatters.date(dateStr) || dateStr;
  return `${GATE_LABELS[key]}  ·  ${label}`;
}

function todayPct() {
  return pct(new Date().toISOString().slice(0, 10));
}

// Month labels for the ruler
function buildMonths() {
  const months = [];
  const cur = new Date(T_START);
  cur.setDate(1);
  while (cur <= T_END) {
    const p = ((cur - T_START) / 864e5 / SPAN) * 100;
    months.push({ label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), pct: p });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

const MONTHS = buildMonths();

// Dot style per gate
const DOT_STYLE = {
  ccReq: { size: 7,  bg: 'transparent', border: '1.5px solid #555' },
  ec:    { size: 7,  bg: '#bbb',        border: '1.5px solid #bbb' },
  cc:    { size: 8,  bg: '#333',        border: '1.5px solid #333' },
  cg:    { size: 7,  bg: '#333',        border: '1.5px solid #333' },
  bc:    { size: 7,  bg: '#333',        border: '1.5px solid #333' },
  pg:    { size: 7,  bg: '#333',        border: '1.5px solid #333' },
  ga:    { size: 10, bg: '#111',        border: '2px solid #111'   },
};

const LABEL_W = 96;   // px — left label column width

export default function ReleaseGantt({ releases }) {
  const containerRef = useRef(null);

  // Sort by GA date
  const sorted = Object.entries(releases)
    .map(([version, cfg]) => ({ version, cfg, ga: getDate(cfg, 'ga') }))
    .filter(r => r.ga)
    .sort((a, b) => a.ga.localeCompare(b.ga));

  if (!sorted.length) return null;

  const tp = todayPct();

  return (
    <div ref={containerRef} style={styles.wrap}>
      {/* Legend */}
      <div style={styles.legend}>
        {GATE_KEYS.map(k => (
          <span key={k} style={styles.legItem}>
            <span style={{
              display: 'inline-block',
              width:  DOT_STYLE[k].size,
              height: DOT_STYLE[k].size,
              borderRadius: '50%',
              background: DOT_STYLE[k].bg,
              border: DOT_STYLE[k].border,
              marginRight: 5,
              verticalAlign: 'middle',
              flexShrink: 0,
            }} />
            {GATE_LABELS[k]}
          </span>
        ))}
        <span style={styles.legItem}>
          <span style={{ display:'inline-block', width:1, height:12, background:'#bbb', marginRight:5, verticalAlign:'middle' }} />
          Today
        </span>
      </div>

      {/* Month ruler */}
      <div style={{ ...styles.ruler, paddingLeft: LABEL_W }}>
        <div style={{ position: 'relative', flex: 1, height: 20 }}>
          {MONTHS.map(m => (
            <span key={m.label} style={{ ...styles.monthTick, left: m.pct + '%' }}>{m.label}</span>
          ))}
          {/* Today tick on ruler */}
          {tp !== null && (
            <div style={{ position:'absolute', top:0, left: tp+'%', width:1, height:'100%', background:'#ccc' }} />
          )}
        </div>
      </div>

      {/* Rows */}
      <div style={{ position: 'relative' }}>
        {/* Today vertical line spanning all rows */}
        {tp !== null && (
          <div style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: `calc(${LABEL_W}px + ${tp}% * (100% - ${LABEL_W}px) / 100)`,
            width: 1,
            background: '#ddd',
            pointerEvents: 'none',
            zIndex: 1,
          }} />
        )}

        {sorted.map(({ version, cfg }) => {
          const ccReqP = pct(getDate(cfg, 'ccReq'));
          const gaP    = pct(getDate(cfg, 'ga'));

          return (
            <div key={version} style={styles.row}>
              {/* Label */}
              <div style={{ ...styles.label, width: LABEL_W }}>
                <span style={styles.versionName}>{version}</span>
              </div>

              {/* Track */}
              <div style={styles.track}>
                {/* Spine line */}
                {ccReqP !== null && gaP !== null && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: ccReqP + '%',
                    width: (gaP - ccReqP) + '%',
                    height: 1,
                    background: '#ddd',
                    transform: 'translateY(-50%)',
                  }} />
                )}

                {/* Gate dots */}
                {GATE_KEYS.map(k => {
                  const p = pct(getDate(cfg, k));
                  if (p === null) return null;
                  const ds = DOT_STYLE[k];
                  return (
                    <div
                      key={k}
                      title={fmtTip(k, getDate(cfg, k))}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: p + '%',
                        width:  ds.size,
                        height: ds.size,
                        borderRadius: '50%',
                        background: ds.bg,
                        border: ds.border,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 3,
                        cursor: 'default',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    background: '#fff',
    border: '1px solid #e9ecef',
    borderRadius: 8,
    padding: '16px 20px 20px',
    marginBottom: 24,
    overflowX: 'auto',
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px 20px',
    marginBottom: 14,
    fontSize: 10,
    color: '#555',
  },
  legItem: {
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  ruler: {
    display: 'flex',
    marginBottom: 6,
  },
  monthTick: {
    position: 'absolute',
    fontSize: 9,
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
    top: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 16,
  },
  label: {
    flexShrink: 0,
    paddingRight: 12,
    textAlign: 'right',
  },
  versionName: {
    fontSize: 12,
    fontWeight: 700,
    color: '#1a1a2e',
    whiteSpace: 'nowrap',
  },
  track: {
    flex: 1,
    position: 'relative',
    height: 24,
  },
};
