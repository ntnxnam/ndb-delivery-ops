import React from 'react';
import {
  Card,
  KPICard,
  SectionPanel,
  MutedLabel,
  Pill,
} from './index.js';

/**
 * DesignSystemDemo — living style guide. Every primitive is rendered
 * in every meaningful variant on a single page. Doubles as the visual
 * QA target whenever tokens change.
 *
 * Reach it via /design (added in App.js, behind release_versions_view).
 *
 * Intent: keep this file editable as the primitives evolve so the
 * "what does our system look like" question is one click away.
 */
export default function DesignSystemDemo() {
  return (
    <div className="ds-scope">
      <div className="ds-page">
        <div className="ds-page__inner">
          <header style={{ marginBottom: 'var(--ds-space-5)' }}>
            <MutedLabel>Portfolio Delivery Ops · Design System</MutedLabel>
            <h1
              style={{
                fontSize: 'var(--ds-fs-page)',
                color: 'var(--ds-text-strong)',
                marginTop: 'var(--ds-space-2)',
                fontWeight: 600,
              }}
            >
              Living style guide
            </h1>
            <p style={{ color: 'var(--ds-muted)', marginTop: 'var(--ds-space-1)' }}>
              Tokens + primitives the new Release Brief and Team-Exec pages
              compose from. Edit primitives, refresh, compare.
            </p>
          </header>

          {/* ── KPI grid ──────────────────────────────────────────── */}
          <SectionPanel
            title="KPI cards"
            caption="The atomic metric. Every count on a new page is one of these."
          >
            <div className="ds-grid-kpis">
              <KPICard
                label="Release Payload"
                value="1,247"
                unit="tickets"
                delta="+28 w/w"
                deltaTrend="up"
                caption="Includes wishlist + deferred"
                rag="green"
                href="https://jira.nutanix.com/issues/?jql=project%3DERA%20AND%20fixVersion%3D%22NDB-2.11%22"
                title="JQL: project=ERA AND fixVersion=NDB-2.11"
              />
              <KPICard
                label="Dev Velocity"
                value="84"
                unit="sp"
                delta="−6 vs S22"
                deltaTrend="down"
                caption="3-sprint avg: 90 sp"
                rag="amber"
              />
              <KPICard
                label="QA Verification"
                value="32"
                unit="adj"
                delta="+4 vs S22"
                deltaTrend="up"
                caption="Bug/Improvement → Closed"
              />
              <KPICard
                label="Open Risks"
                value="3"
                delta="2 new"
                deltaTrend="down"
                rag="red"
                caption="Owner attention required"
              />
              <KPICard
                label="Days to GA"
                value="42"
                deltaTrend="flat"
                caption="GA: 2026-07-01"
                rag="green"
              />
            </div>
          </SectionPanel>

          {/* ── Cards ─────────────────────────────────────────────── */}
          <SectionPanel
            title="Cards"
            caption="The container primitive. KPICard, SectionPanel, and most page widgets are Cards underneath."
          >
            <div className="ds-row">
              <Card style={{ minWidth: 280 }}>
                <MutedLabel>Default</MutedLabel>
                <p style={{ marginTop: 'var(--ds-space-2)' }}>
                  Standard surface tier — most content sits here.
                </p>
              </Card>
              <Card variant="raised" style={{ minWidth: 280 }}>
                <MutedLabel strong>Raised</MutedLabel>
                <p style={{ marginTop: 'var(--ds-space-2)' }}>
                  One tier brighter. Use for "selected" or "active" state.
                </p>
              </Card>
              <Card variant="quiet" style={{ minWidth: 280 }}>
                <MutedLabel>Quiet</MutedLabel>
                <p style={{ marginTop: 'var(--ds-space-2)' }}>
                  No surface, padding only. Slot inside SectionPanel when
                  you want grouping without double-borders.
                </p>
              </Card>
              <Card
                clickable
                style={{ minWidth: 280 }}
                onClick={() => alert('Card clicked')}
              >
                <MutedLabel>Clickable</MutedLabel>
                <p style={{ marginTop: 'var(--ds-space-2)' }}>
                  Hover for the affordance. Use sparingly — usually
                  KPICard's <code>href</code> is the right answer.
                </p>
              </Card>
            </div>
          </SectionPanel>

          {/* ── Pills ─────────────────────────────────────────────── */}
          <SectionPanel
            title="Pills"
            caption="Small inline tags. Use for status, category, count badges."
          >
            <div className="ds-row" style={{ alignItems: 'center' }}>
              <Pill tone="accent">primary</Pill>
              <Pill tone="success">healthy</Pill>
              <Pill tone="warning">at risk</Pill>
              <Pill tone="danger">blocked</Pill>
              <Pill tone="muted">neutral</Pill>
              <Pill tone="success">+12 w/w</Pill>
              <Pill tone="muted">NDB-2.11</Pill>
            </div>
          </SectionPanel>

          {/* ── Section variants ──────────────────────────────────── */}
          <SectionPanel
            title="Section with actions"
            caption="Header strip supports a caption and right-aligned actions."
            actions={
              <>
                <Pill tone="muted">last sync 3m ago</Pill>
                <Pill tone="accent">resync</Pill>
              </>
            }
          >
            <p style={{ color: 'var(--ds-muted)' }}>
              Section body. Most pages stack 3–5 of these end to end.
            </p>
          </SectionPanel>

          <SectionPanel
            title="Flush section"
            caption="Body padding off — for tables, Gantts, anything that owns its bleed."
            flush
          >
            <div
              style={{
                padding: 'var(--ds-space-3) var(--ds-space-4)',
                borderBottom: '1px solid var(--ds-divider)',
                display: 'grid',
                gridTemplateColumns: '1fr 120px 120px 80px',
                gap: 'var(--ds-space-3)',
              }}
            >
              <MutedLabel>Project</MutedLabel>
              <MutedLabel>Owner</MutedLabel>
              <MutedLabel>Gate</MutedLabel>
              <MutedLabel>Status</MutedLabel>
            </div>
            {[
              ['Snowflake Restore', 'A. Patel', 'Code Complete', 'green'],
              ['Object Storage UX', 'M. Chen', 'Commit Gate', 'amber'],
              ['NDB-Agent Hardening', 'R. Iyer', 'Promotion Gate', 'red'],
            ].map(([proj, owner, gate, rag]) => (
              <div
                key={proj}
                style={{
                  padding: 'var(--ds-space-3) var(--ds-space-4)',
                  borderBottom: '1px solid var(--ds-divider)',
                  display: 'grid',
                  gridTemplateColumns: '1fr 120px 120px 80px',
                  gap: 'var(--ds-space-3)',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: 'var(--ds-text-strong)' }}>{proj}</span>
                <span style={{ color: 'var(--ds-muted)' }}>{owner}</span>
                <span className="ds-num" style={{ color: 'var(--ds-muted)' }}>{gate}</span>
                <span className={`ds-kpi__rag ds-kpi__rag--${rag}`} />
              </div>
            ))}
          </SectionPanel>

          {/* ── Typography sample ─────────────────────────────────── */}
          <SectionPanel
            title="Typography"
            caption="Compact scale: 12 muted / 14 body / 16 section / 22 page / 28 KPI number."
          >
            <div style={{ display: 'grid', gap: 'var(--ds-space-3)' }}>
              <span style={{ fontSize: 'var(--ds-fs-page)', color: 'var(--ds-text-strong)' }}>
                Page title (22px / 600)
              </span>
              <span style={{ fontSize: 'var(--ds-fs-section)', color: 'var(--ds-text-strong)' }}>
                Section title (16px / 600)
              </span>
              <span style={{ fontSize: 'var(--ds-fs-body)' }}>
                Body copy (14px / 400) — comfortable on a 13″ screen at
                normal zoom; tabular numerals via .ds-num.
              </span>
              <span style={{ fontSize: 'var(--ds-fs-small)', color: 'var(--ds-muted)' }}>
                Small text (13px) — dense tables, captions, deltas.
              </span>
              <MutedLabel>Muted label (12px uppercase / 600)</MutedLabel>
            </div>
          </SectionPanel>

          {/* ── Color tokens ──────────────────────────────────────── */}
          <SectionPanel
            title="Color tokens"
            caption="Each swatch is one CSS variable. Change at source = changes everywhere."
          >
            <div className="ds-grid-kpis">
              {[
                ['--ds-bg', 'Base page background'],
                ['--ds-surface', 'Card / panel surface'],
                ['--ds-surface-raised', 'Selected surface'],
                ['--ds-border', 'Default border'],
                ['--ds-accent', 'Single accent (links, focus)'],
                ['--ds-success', 'Status: green'],
                ['--ds-warning', 'Status: amber'],
                ['--ds-danger', 'Status: red'],
              ].map(([token, label]) => (
                <Card key={token}>
                  <div
                    style={{
                      width: '100%',
                      height: 32,
                      borderRadius: 'var(--ds-radius)',
                      background: `var(${token})`,
                      border: '1px solid var(--ds-border)',
                      marginBottom: 'var(--ds-space-2)',
                    }}
                  />
                  <MutedLabel>{label}</MutedLabel>
                  <div style={{ marginTop: 4, fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-fs-small)', color: 'var(--ds-muted)' }}>
                    {token}
                  </div>
                </Card>
              ))}
            </div>
          </SectionPanel>
        </div>
      </div>
    </div>
  );
}
