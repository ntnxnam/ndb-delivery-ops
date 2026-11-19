# AI Audit Trail — How to Read & Write

This directory is the **discovery layer** for per-page AI audit trails. The trails themselves live **next to each page's source** (co-located `ai-audit-docs/`), not here — this folder holds the hub, timeline, and cross-page learning log.

## Where things live

```
apps/delivery-ops/client/src/<page-source>/ai-audit-docs/
  INDEX.md                                          ← per-page chronological table (generated)
  YYYY-MM-DD__kebab-slug__weave-<slug>.md           ← one journal file per weave

docs/ai-audit/
  INDEX.md       ← hub linking every page's trail (generated)
  timeline.md    ← all pages chronological (generated)
  LEARNINGS.md   ← cross-page mistake log (append-only, hand-curated)
  README.md      ← this file
```

Registry: `apps/delivery-ops/server/config/aiAudit.config.json` — `pages.<Page>.auditPath` is the source of truth for where each page's trail lives. See `agent-pack/loom/rules/ai-audit-docs.mdc` for naming, template, and placement rules.

## Reading a page's trail

1. Look up the page in `aiAudit.config.json` → `auditPath`
2. Open that folder's `INDEX.md` for the chronological table
3. Or open `docs/ai-audit/timeline.md` for a global view across all pages
4. Check `LEARNINGS.md` for mistakes that were already learned — don't repeat them

## Adding a new entry (during a weave)

```bash
# Scaffold — validates page name, naming pattern, and handles same-day dedup
scripts/loom/ai-audit/new-entry.sh --page <PageName> --slug <kebab-slug> --weave <weave-slug>

# Fill the scaffolded file — all frontmatter + body sections required (see template.md)
# Then regenerate indexes:
node scripts/loom/ai-audit/rebuild-indexes.js

# Also regenerates via the normal doc build:
node scripts/lighthouse/docs/docs-build.js
```

Required sections per `ai-audit-docs.mdc`: Prompt verbatim, GOAL/DONE WHEN, AI Config Snapshot, Changes, Decisions, **Mistakes & Corrections**, Verification, Links, Config Delta, Follow-ups.

## When a mistake is cross-page

If the **Mistakes & Corrections** section reveals a pattern that could affect other pages, also append to `LEARNINGS.md`:

```markdown
## YYYY-MM-DD — <category> — <short title>
- **Page:** <PageName> (`<route>`)
- **Mistake:** what went wrong
- **Correction:** how it was fixed
- **Prevention:** rule or check to avoid repeating it
- **Source:** `<page-audit-path>/YYYY-MM-DD__...md`
```

Loom's builder prompt reads `LEARNINGS.md` before every weave.

## What not to do

- Don't create an audit folder outside the registry — update `aiAudit.config.json` first
- Don't edit old journal files — they're immutable; add a new entry
- Don't skip **Mistakes & Corrections** — write "No mistakes this weave." if true
- Don't hand-edit `INDEX.md` table rows — they're generated
