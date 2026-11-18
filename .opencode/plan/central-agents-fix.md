# Central AGENTS Fix — Proper Plan (not bandaid)

**Problem:** Root `AGENTS.md` is called "central" but it's repo-specific delta (D2). Real SoT is `agent-pack/` (D38 portable pack). 12 docs hardcode `.cursor/*` as if Cursor is the harness — breaks opencode today, claude tomorrow.

## Root Cause
- `AGENTS.md` at root says "project AGENTS" but docs reference it as central.
- `.cursor/AGENTS.md` is host adapter, not source — but docs treat `.cursor/skills`, `.cursor/rules`, `.cursor/context` as canonical.
- `Documentation/handover/`, `DEVELOPER_GUIDE.md`, `ARCHITECTURE.md` still point to `.cursor/mcp.json`, `.cursor/agents`, etc.

## Target State
1. **Hierarchy (one sentence per file, no misnomer):**
   - `AGENTS.md` (root) = repo router: "This repo: portfolio-delivery-ops. See `agent-pack/product/lighthouse` for product, `agent-pack/loom` for builder. Loads via `AGENT_PACK_ROOT`."
   - `agent-pack/identity/ops-assistant.md` = orchestrator SoT (D16)
   - `agent-pack/context/INDEX.md` + `prompts/INDEX.md` = domain SoT
   - `agent-pack/harness/*` = host adapters (opencode/cursor/claude/codex) — generate `.cursor/*` at `install.sh` time, never committed as source.

2. **All docs reference `agent-pack/` not `.cursor/`:**
   - `ARCHITECTURE.md`, `DEVELOPER_GUIDE.md`, `01-Platform-Overview.md` etc. — replace `.cursor/skills` → `agent-pack/product/lighthouse/skills`, `.cursor/rules` → `agent-pack/*/rules`, `.cursor/mcp.json` → `mcp-lighthouse`/`mcp-loom`.
   - Keep `.cursor/AGENTS.md` as 5-line pointer: "Run `agent-pack/harness/install.sh --harness cursor`".

3. **Docs that are cross-app stay `docs/architecture/`**, not root `.md` sprawl.

## Migration (phases, each green)
- Phase 0: `grep -r "\.cursor" --include="*.md"` inventory (done: 12 hits).
- Phase 1: Patch `AGENTS.md` root header to "Repo router, not central — see agent-pack/".
- Phase 2: Patch `DEVELOPER_GUIDE.md`, `ARCHITECTURE.md`, `01-Platform-Overview.md`, `03-Operations-Guide.md` etc. — replace `.cursor/*` refs with `agent-pack/*` + `mcp-lighthouse/looms`.
- Phase 3: Patch `.cursor/AGENTS.md` to reference `agent-pack/harness/` (not `.cursor/agents`).
- Phase 4: Verify — `grep -r "\.cursor" --include="*.md" | wc -l` should be 0 (except `.cursor/AGENTS.md` self-ref + `.cursor/.gitignore`).

## Verification
- `grep -r "\.cursor" --include="*.md" --exclude-dir=node_modules` → only `AGENTS.md` router + `.cursor` self.
- `loadAgentPack()` both packs still 18/5 skills.
- `npm --prefix shared run build` + `mcp-*` builds pass.

## Not bandaid
- No find-replace of `.cursor` → `agent-pack/harness` string. Each doc updated with correct new path (skills→product/lighthouse/skills, rules→product/lighthouse or loom, mcp→mcp-lighthouse/looms).
- Root `AGENTS.md` rewritten, not patched line 1.
