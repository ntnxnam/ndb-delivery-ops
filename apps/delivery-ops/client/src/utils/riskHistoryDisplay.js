/**
 * riskHistoryDisplay — renders a Risk Indicator (RAG) movement trail.
 *
 * Mirrors the date-movement trail (formatDateWithHistory) but for the
 * Risk Indicator select field. The server (fieldHistoryUtils) captures the
 * changelog transitions and exposes them as
 *   checkpointHistory[key].riskIndicator = [{ value, changedAt }]  (oldest → newest)
 *
 * We show the current value in its RAG colour, with prior distinct values
 * struck-through to the right, e.g.  Red ← Yellow ← Green.
 */

import React from 'react';

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c' };

/**
 * Reduce a raw select value / changelog string to its RAG word.
 * "Green - On Track" → "Green"; { value: "Red - ..." } → "Red".
 */
function riskWord(v) {
  if (v == null) return null;
  const s = typeof v === 'object' ? (v.value || v.name || '') : String(v);
  const trimmed = s.trim();
  if (!trimmed || trimmed === 'null') return null;
  const word = trimmed.split(/[\s-]/)[0].trim();
  return word || null;
}

/**
 * Build the consecutive-deduped sequence of RAG words (oldest → newest) from
 * the history entries plus the current value.
 * @returns {string[]}
 */
function buildRiskSequence(itemKey, currentRisk, checkpointHistory) {
  const key = (itemKey || '').trim();
  const hist = (checkpointHistory && checkpointHistory[key] && checkpointHistory[key].riskIndicator) || [];

  const seq = [];
  const push = (w) => {
    if (!w) return;
    if (seq[seq.length - 1] === w) return; // collapse consecutive dupes
    seq.push(w);
  };

  hist.forEach((e) => push(riskWord(e && e.value)));
  push(riskWord(currentRisk));

  return seq;
}

/**
 * Render the risk movement trail, or null when there's no movement (≤1 distinct
 * value) — in which case the caller just shows the RAG dot on its own.
 *
 * @param {string} itemKey
 * @param {*} currentRisk - item.customfield_23560 (string or { value })
 * @param {Object} checkpointHistory
 * @returns {JSX.Element|null}
 */
export function formatRiskWithHistory(itemKey, currentRisk, checkpointHistory) {
  const seq = buildRiskSequence(itemKey, currentRisk, checkpointHistory);
  if (seq.length <= 1) return null; // no movement

  const newestFirst = [...seq].reverse();

  return (
    <span style={{ fontSize: '10px', display: 'inline-block', lineHeight: 1.35 }}>
      {newestFirst.map((word, i) => (
        <span key={`${word}-${i}`} style={{ whiteSpace: 'nowrap' }}>
          {i > 0 && <span style={{ color: '#999' }}> ← </span>}
          <span
            style={
              i === 0
                ? { color: RAG_COLORS[word] || '#616161', fontWeight: 700 }
                : { textDecoration: 'line-through', color: '#9e9e9e' }
            }
          >
            {word}
          </span>
        </span>
      ))}
    </span>
  );
}

export default formatRiskWithHistory;
