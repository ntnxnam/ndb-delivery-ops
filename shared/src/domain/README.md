# shared/src/domain — domain derives (D41)

Pure, browser-safe derivations shared between server, MCP, and React.
No JIRA I/O, no Node builtins beyond `require`.

## Conventions

| File | Format | Why that format |
|------|--------|----------------|
| `execSummarySignals.cjs` | CJS | Express `require()` without ESM interop; also importable from ESM via `createRequire`. SoT for signal derivation. |
| `execSummaryAnalytics.cjs` | CJS | Same reason — Express route injects `gateDates` + `formatDate`. |
| `sprintMetrics.cjs` | CJS | SoT for sprint health rates; `shared/src/services/sprintMetrics.ts` is the typed ESM wrapper that mirrors this logic. |
| `bundleDerive.js` | ESM (`.js`) | Browser-safe; CRA imports the same-export adapter copy at `apps/delivery-ops/client/src/release/utils/bundleUtils.js` (CRA cannot import `@portfolio-delivery-ops/shared` without pulling Node connectors). Keep the two in sync — `smoke:wave3` checks this. |

`shared/package.json` `exports` point directly at `src/domain/*` (not `dist/`) because these files are intentionally excluded from `tsconfig.json` (`exclude: ["src/domain"]`) and are consumed as source.

## Deduplication

`sprintMetrics` exists in two places — `src/domain/sprintMetrics.cjs` (CJS SoT) and `src/services/sprintMetrics.ts` (typed ESM wrapper). They implement identical logic; the wrapper re-exports types. `shared/src/index.ts` re-exports the typed version.

## Adding a new domain module

1. Pick CJS if Express needs `require()`, ESM if it must run in the browser bundle.
2. Add an entry to `shared/package.json` `exports`.
3. Add a header comment referencing the D41 table in ARCHITECTURE.md.
4. If a CRA adapter copy is needed, note it in this README.
