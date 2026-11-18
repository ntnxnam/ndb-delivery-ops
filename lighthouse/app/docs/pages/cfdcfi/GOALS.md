# Goals — CFD / CFI hero → in-page popup

## Primary

| ID | Goal | Done when |
|----|------|-----------|
| G1 | Pulse hero click opens in-page drill | Clicking Open now / aged / P0 / P1 on `/cfdcfi` opens `OpenTicketsDrill` with ticket rows |
| G2 | JIRA authenticity preserved | Drawer header still links the exact hero `cell.jql` |
| G3 | Shared kit stays reusable | `PulseHero` / `KpiPulseBand` gain optional `onOpen` / `onHeroClick`; other consumers unchanged when props omitted |
| G4 | Verified | Unit/component tests pass; requirements AC updated; STATUS shows KPI MET |

## Verification artifacts

- **Tests**: client/unit tests for PulseHero onOpen + CfdCfi drill wiring helpers
- **KPI dashboard**: `/cfdcfi` heroes open drawer (manual / documented AC)
- **Release artifact**: updated `CfdCfi-requirements.md` AC + this STATUS.md evidence block
