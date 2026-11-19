---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
source: doc-release-notes @ 2026-05-19
---

# Release Notes

> Rolling notes. Per-release files live under `docs/release-notes/<version>.md`. Maintained by `doc-specialist` via `doc-release-notes`.

## NDB 2.11 — _TBD_

See [NDB-2.11.md](./NDB-2.11.md) when cut.

### Fix: Risk Details on Project Status (47780 / 55664)

- Risk Assessment (`customfield_47780`) and Path to Green (`customfield_55664`) now render as plain text on `/project-status` → Risk Details (ADF doc → plain text; `customfield_38460` email HTML unchanged). Stale cached HTML payloads strip to text on next fetch; URLs still render as Link, empty as Not Set. See [USER_GUIDE — Risk Details](../guides/USER_GUIDE.md#risk-details-project-status).

### Recent changes (TCMS Quality table)

- TCMS Quality table now renders **Functional** and **System** rows (2×2:
  Functional/System × Manual/Automation) instead of the legacy
  Overall/Functional/Automation layout. `Overall` is no longer a row/title.
- Window label aligned to data source: **Last 4 weeks** (key
  `releaseLast4Weeks`/`masterLast4Weeks`), with deprecated alias
  `releaseLast3Weeks`/`masterLast3Weeks` retained for back-compat.
- Legacy `overall` data falls back to the **System** row for back-compat.
- Caveat: Functional and System rows currently share the same source metrics
  (clone) until TCMS exposes a `test_category` filter — see
  `KNOWN_ISSUES.md` and `docs/tcms-rows-followup.md`.
- TCMS time-filtered metrics corrected: "Last 4 weeks" now queries
  `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks`
  and `target={milestone}-qcow2`, returning genuinely filtered data instead
  of erroring or echoing Overall. See `docs/tcms-rows-followup.md` (Endpoint
  migration).

## Unreleased — weave-client-fields-labels (jiraFieldsConfig v1.1.0 client consolidation)

- **Client SoT mirror:** `client/src/config/jiraFieldsConfig.json` mirrors server SoT (8 field cats + labels taxonomy: porExclude, lifecycle{deferred,mustfix,wishlist,longTermFunded,extension}, dependency.trainAsk, testType.systemTest).
- **fieldConfig fetch-cache:** `client/src/utils/fieldConfig.js` ensureLoaded() via `GET /api/config/jira-fields` (fetch-once, cached) delegates to `client/src/utils/jiraFields` (getFieldId/getLabelJql); consumers must await ensureLoaded() before use.
- **385→0 (resilience):** Hardcoded field IDs/labels removed from client services — all resolved via SoT; badge contrast fix on status pills.
- **P2 cache labels:** trainAsk/longTerm cache keys use taxonomy patterns (no inline strings).
- **Live proof 3× HTTP200:** `/api/config/jira-fields`, project-status, and dependency-view all 200 on QA run.

## Unreleased — `weave/feature-dashboard-shared-views` (bin-packing converter + `NAI_*` canonical)

> Merge target: `main` @ `eb71a25`. Source: `apps/bin-packing`, `shared/src/connectors/aiConnector.ts`, `shared/src/services/csvConverterService.ts`, `mcp/shared/tools/convertToBinPackingCsv.ts`, `agent-pack/lighthouse/skills/csv-to-binpacking/`, `apps/delivery-ops/server/routes/binPackingConvert.js`.

- **Bin-Packing — universal file → canonical CSV converter (new):** any `.csv`, `.tsv`, `.xlsx`, `.xls`, `.pdf`, `.docx`, `.html`/`.htm` or pasted TSV/CSV (≤ 10 MB) can be converted to the canonical 26-column Sheet1 CSV via **Convert any file (AI)** above the existing upload card in `apps/bin-packing/upload.html`. Preview maps headers via the product-aware alias table (`shared/src/services/productColumnAliases.ts`), surfaces warnings/missing-mandatory, validates through `shared/src/services/csvConverterService.ts`, and offers **Download CSV** or **Replace & Repack** (direct chart render). Server path `POST /api/bin-packing/convert` accepts `multipart/form-data` (primary) and `JSON { filename, contentBase64, mimeType }` (fallback), is auth-guarded (`apiLimiter` + `validateJiraTokenMiddleware`, same as `POST /api/ai/*`), and runs per-request `mkdtemp` isolation. See [USER_GUIDE — Bin-Packing CSV Converter](../guides/USER_GUIDE.md#bin-packing-csv-converter) and [CSV Converter Guide](../product/CSV_CONVERTER_GUIDE.md). No change to the existing CSV/XLSX upload or the deterministic bin-packing scheduler.
- **MCP — `convertToBinPackingCsv` tool:** new read-only tool in `mcp/shared` (exposed via `mcp/lighthouse` as `lighthouse-mcp`). Input `filePath` is validated (10 MB ceiling, traversal + MIME guard) and returns `{ csvText, warnings, stats, validation }`.
- **Skill — `agent-pack/lighthouse/skills/csv-to-binpacking/`:** `SKILL.md` (frontmatter: `name: csv-to-binpacking`, `audience: portfolio_mgr`, triggers), `prompt.md` (placeholders `{productId}`, `{filePath}`), `examples.md` (4 worked flows + anti-patterns). Orchestrator-only — deterministic logic stays in `shared`. No forked copy under `.claude/skills` / `.cursor/skills` (harness symlinks only).
- **AI config — `NAI_*` canonical (5 vars):** `NAI_API_KEY`, `NAI_API_BASE_URL`, `NAI_DEFAULT_MODEL`, `NAI_MAX_TOKENS`, `NAI_REQUEST_TIMEOUT` are canonical; `AI_*` kept as fallback. Non-secret defaults live in `server/config/aiConfig.json` (`baseUrl`, `defaultModel`, `maxTokens`, `requestTimeoutMs`); secrets in `server/.env` only. Resolution: `per-call override → NAI_* env (→ AI_* fallback) → aiConfig.json → throw actionable NAI_* error`. Documented in [ADMIN_GUIDE — AI / NAI Configuration](../guides/ADMIN_GUIDE.md#ai--nai-configuration) and [LLD — NAI Configuration §7](../technical/LLD-ai-layer.md#7-nai-configuration--canonical-nai-precedence). `apps/delivery-ops/server/.env.example` updated. Server now throws `NAI_API_KEY is not set…` / `NAI_API_BASE_URL is not set…` etc. — error tables in `docs/api/ai.md` and `apps/delivery-ops/docs/api/ai.md` reflect the canonical names.
- **Server — body parser limit:** `bodyParser.json({ limit: '15mb' })` (was `1mb`) in `server/index.js` to allow 10 MB binary via the JSON base64 path (≈13.3 MB b64). Documented in [ADMIN_GUIDE](../guides/ADMIN_GUIDE.md#bin-packing-converter--server--auth--limits).
- **Known limitation added:** [KNOWN_ISSUES.md#bin-packing-converter](../known-issues/KNOWN_ISSUES.md) — 10 MB cap, restricted extension allowlist.

## Template for next release

Copy into `release-notes/<version>.md`:

- Highlights (3-5 exec-readable bullets)
- What's New / Enhancements / Bug Fixes
- Breaking Changes (⚠️ + migration step)
- Upgrade Notes
- Known Issues → [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md)
