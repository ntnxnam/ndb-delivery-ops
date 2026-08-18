/**
 * SoS Summary Page — Scrum of Scrums status view for engineering leadership.
 *
 * Shows all active releases in one scrollable view. Each release section
 * contains Features → Initiatives (with AI exec summaries + task breakdowns)
 * and per-release KPI widgets. A compose panel at the bottom lets the
 * Portfolio Manager draft and send a leadership briefing email.
 *
 * Full implementation added in feature/sos-page branch.
 * This stub allows navigation to render while the full page is built.
 */

import React from 'react';

function SosSummaryPage() {
  return (
    <div style={{ padding: '32px', textAlign: 'center', color: '#6c757d' }}>
      <h2 style={{ color: '#333', marginBottom: '12px' }}>SoS Summary</h2>
      <p style={{ fontSize: '15px', marginBottom: '8px' }}>
        Scrum of Scrums — live Feature &amp; Initiative status across all active releases
      </p>
      <p style={{ fontSize: '13px', color: '#aaa' }}>
        Full implementation coming in the next branch (feature/sos-page).
      </p>
    </div>
  );
}

export default SosSummaryPage;
