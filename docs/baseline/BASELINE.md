# MVP 0 baseline report

Status of the MVP 0 deliverables from `docs/RIVER_SIMULATION_TECHNICAL_SPEC.md` §15. Source: commit `d320b69` plus the MVP 0 changes.

## Delivered

| Deliverable | Where |
|---|---|
| Clock/random audit | `docs/baseline/NONDETERMINISM_AUDIT.md`, regenerate with `npm run audit` |
| Fixture generator (isolated DBs) | `npm run fixtures [outDir]` → `.fixtures/`: new-life, injury, fire, crafting, animals, grants |
| Schema version table + migration framework | `src/server/migrate.ts`, table `sim_migrations`, run from `db.ts` |
| Backup / verify / restore | `npm run db:backup -- backup\|verify\|restore ...` |

## Measured

- `npm run typecheck`: passes (before and after the changes).
- Authoritative-time hazards in `src/server` + `src/shared`: 13 `setInterval`, 48 `setTimeout`, 63 `Math.random`, 125 `Date.now`/`new Date`. Not all need migration (API timeouts, budget windows and UI stay on wall time); the audit lists each one for MVP 1 triage.
- Backup of a copy of the live DB: integrity `ok`, row counts match. Opening that copy through `db.ts` applied `0001_baseline` and `0002_legacy_columns` without error. The live DB itself was only read.
- Fixtures never touch `data/`: the generator rejects any output path inside it and rejects `RIVER_DB` values pointing there.

## Not measured

- **Token use per simulated day.** The mock brain (`MOCK_LLM=1`) spends no tokens, so it cannot supply the baseline for the MVP 4 "50% fewer tokens" target. That needs a live-model run on matched seeds with a real key and spend, and is not done.
- Scenario outcomes beyond fixture creation (no replay exists yet).

## Behavior change to note

The old `ALTER TABLE ... try/catch` block in `db.ts` is replaced by migration `0002`. Same columns; failures other than "already exists" now throw instead of being swallowed.

## Migration checklist

1. `npm run db:backup -- backup data/river.db data/backups/<name>.db`
2. `npm run db:backup -- verify data/river.db data/backups/<name>.db`
3. Start the server; check `sim_migrations` has the expected IDs.
4. Rollback: stop the server, `npm run db:backup -- restore <backup> data/river.db --force`.
