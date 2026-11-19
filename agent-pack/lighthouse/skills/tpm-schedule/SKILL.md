# tpm-schedule

TPM schedule surface — CRUD for schedules + cron runner + SchedulePage.

Owns: `apps/delivery-ops/client/src/components/SchedulePage.*`, `apps/delivery-ops/server/routes/tpmSchedules.js`, `apps/delivery-ops/server/services/tpmScheduleRunner.js`, `apps/delivery-ops/server/utils/tpmSchedulesStore.js`, `apps/delivery-ops/server/config/schedules.json`, `shared/src/types/tpmSchedule.ts`.

Routes: `GET/POST/PUT/DELETE /api/config/schedules`. Runner ticks via node-cron, respects D26 auth, To/CC, deferral-after-PG.

See plan at `docs/tpm-agent-plan.md` and contracts at `agent-pack/lighthouse/skills/tpm-contracts/`.
