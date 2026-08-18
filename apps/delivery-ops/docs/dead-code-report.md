# Dead Code Report

Generated during Track 4 of the full refactor plan.

## Tooling run

- `knip`: failed to run due to environment TLS issue (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`)
- `jest --coverage --coverageProvider=v8`: completed with coverage output

## Coverage summary

- Statements: 32.41%
- Branches: 50.75%
- Functions: 22.62%
- Lines: 32.41%

## Priority interpretation

- Function coverage (22.62%) indicates substantial uncalled code paths and/or untested helper flows.
- Branch coverage (50.75%) indicates many conditional paths are never exercised.

## Immediate candidates for path-trimming follow-up

- `server/routes/jira/*.js` (newly split route modules) — large async control paths.
- `server/utils/execSummarySignals.js` — complex branching signal logic.
- `server/utils/ganttChartEmailGenerator.js` — branching format/path logic.
- `client/src/components/EmailSender/EmailSender.js` — large UI state machine.
- `client/src/release/utils/bundleUtils.js` — transformation helpers with sparse test coverage.

## Notes

- `knip` output is missing due to npm certificate setup in the current environment.
- Re-run `npx knip --include exports --reporter compact` after certificate remediation to capture dead exports precisely.
