# AI Audit — Learnings (Anti-Repeat Log)

> Cross-page mistakes that must not be repeated. Loom's builder reads this file before every weave.
> When a new cross-page mistake is found, append an entry here **and** keep the full context in that page's own `ai-audit-docs/` journal.

## How to add an entry

```markdown
## YYYY-MM-DD — <category> — <short title>
- **Page:** <PageName> (`<route>`)
- **Mistake:** what went wrong
- **Correction:** how it was fixed
- **Prevention:** rule or check to avoid repeating it
- **Source:** `<page-audit-path>/YYYY-MM-DD__...md`
```

Categories: `jql` | `layout` | `config` | `naming` | `process` | `data` | `auth` | `other`

---

<!-- No learnings yet — this file was created with the initial audit trail seed on 2026-11-20. -->
<!-- Append entries below as mistakes are discovered in future weaves. -->

_Seeded on 2026-11-20 with the initial audit trail. No cross-page mistakes have been logged yet._

## 2026-11-19 — data — duplicate RAG palette + unescaped risk history HTML
- **Page:** ProjectStatus (`/project-status`), SosSummary (`/sos-summary`), EmailSender (`/`)
- **Mistake:** `RAG_COLORS` duplicated across `ReleaseVersionTableCell`, `emailTableGenerator`, `sosEmailHtml` violating D41 SoT; `formatRiskWithHistoryHTML` interpolated raw risk words without escaping (XSS).
- **Correction:** Consolidated to `client/src/utils/riskHistoryDisplay.js` SoT (`RAG_COLORS`, `riskWord`, `getRagColor`, `formatRiskWithHistoryHTML` with `escapeHtml`); server `releaseHistoryService` now passes `includeRiskIndicator:true`.
- **Prevention:** Grep `RAG_COLORS` — must have single definition in `riskHistoryDisplay.js`; docs-verify SoT check; always escape HTML-bound derived words.
- **Source:** `apps/delivery-ops/client/src/components/ai-audit-docs/ProjectStatus/2026-11-19__risk-indicator-trail__weave-risk-indicator-trail.md`
