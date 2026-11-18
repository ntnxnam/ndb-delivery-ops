# Themes Roadmap — Light is Default, Dark is Parked

**Status:** Light theme is the only shipped theme. Dark / per-user theme switching is a parked roadmap item. This document exists to make that intent explicit and to show how tokens are already theme-ready.

## What shipped

- All tokens live as CSS custom properties on `:root` in `apps/delivery-ops/client/src/styles/tokens.css` (canonical source). Every CSS file and component should reference `var(--*)` — no hard-coded hex in JS/CSS outside `tokens.css`.
- `index.css` and `App.css` are token-driven. `layout/components/Layout.css` + `Sidebar.css` extracted from inline `<style>` blocks and now consume sidebar/chrome tokens (`--sidebar-*`, `--header-*`). Project Status cells (`ReleaseVersionTableCell.css`) moved from inline `style={{}}` to classes (`.rv-*`) using RAG tokens.
- Legacy `design-system/tokens.css` (dark `.ds-scope`) is still present for the three opt-in pages but now aliases `var(--ds-*) → var(--*)` so those pages render correctly on the light surface.

## How to add dark (no code yet, just the seam)

1. Add `html[data-theme="dark"] { ... }` to `styles/tokens.css` overriding the same `:root` vars (full dark palette is the old `design-system/tokens.css` values: `--bg #0f1419`, `--surface #1a2332`, etc.). Commented skeleton already in the file.
2. Wire a runtime switch: persist `data-theme` on `document.documentElement`, expose toggle in `Sidebar` footer.
3. Contrast QA: re-check every text-on-bg pair verified for light (body 16:1, muted labels 7.5:1, Not Set 7:1, RAG white-on-color ≥4.5:1) against dark. `DesignSystemDemo` at `/design` is the visual QA target.

No runtime switch in this slice — adding one now would double QA with no user ask.
