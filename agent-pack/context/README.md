# Agent-pack context (portable domain knowledge)

Host-agnostic domain and page context for portfolio-delivery-ops.

This is **not** Cursor-only. Any host (Cursor, web chat, Slack, vendor agent)
loads these files via `loadAgentPack()` or by reading this directory.

Page **requirements / data-layer** docs stay under
`apps/delivery-ops/docs/pages/` (engineering contracts). Context files here
are the **agent-facing brief**: what the surface is for, which prompts apply,
which signals matter, and what not to invent.

## Layout

| Path | Contents |
|---|---|
| `domain/` | Cross-cutting domain facts (gates, workflows, deferrals, hygiene) |
| `pages/` | One brief per product surface (route / job) |
| `INDEX.md` | Master map — start here on a new host |

## Rules

1. Prefer linking to `docs/pages/*` and `docs/api/*` over duplicating contracts.
2. When a prompt depends on a signal, name the signal and the code path.
3. Open questions stay marked `OPEN:` — do not pretend they are decided.
4. Product-specific strings belong in config (`productService`), not hard-coded
   as the only valid example — examples may use NDB as a fixture.
