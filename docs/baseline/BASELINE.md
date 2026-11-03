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

## Live-model token baseline (pre-cutover code)

One run, `npm run baseline -- 12` on the `new-life` fixture, model `deepseek-flash`, code at commit `6e64e7c` (old timers). 12 wall minutes = 0.5 simulated day.

| Metric | Value |
|---|---|
| Model calls | 84 (in 2 thought cycles, about 42 tool-step calls each) |
| Input / output tokens | 995,541 / 15,030 |
| Cache-hit input tokens | 971,264 (97.6%) |
| Tokens per simulated day | about 2.0 million (extrapolated from half a day) |
| Memories written | 14 |

Reading it: the cost is dominated by long tool loops that resend the whole context on every step, not by the number of cycles. Cache hits are very high, so billed cost is far lower than the raw token count. This is a single run on a single seed; the MVP 4 target needs several matched runs, and the variance between runs is unknown. The earlier one-minute smoke test (224k tokens per simulated day) was a startup artifact and should be ignored.

## Not measured

- Scenario outcomes beyond fixture creation (no replay exists yet).
- Token use after the cutover: the same command on the new code is the comparison point.

## Behavior change to note

The old `ALTER TABLE ... try/catch` block in `db.ts` is replaced by migration `0002`. Same columns; failures other than "already exists" now throw instead of being swallowed.

## Migration checklist

1. `npm run db:backup -- backup data/river.db data/backups/<name>.db`
2. `npm run db:backup -- verify data/river.db data/backups/<name>.db`
3. Start the server; check `sim_migrations` has the expected IDs.
4. Rollback: stop the server, `npm run db:backup -- restore <backup> data/river.db --force`.

## MVP 1 cutover (commit `14257fd`)

- `src/server/sim.ts` is the single clock. Periodic systems, one-shot timers and awaitable sleeps run on its ticks; random draws come from seeded streams saved with the clock.
- Operational timers stay on wall time: API timeouts, token and cycle budgets, error backoff, embedding batches, socket pushes.
- Day length is now clock speed (`dayMinutes` sets speed to `24 / N`); the calendar is fixed at 24 minutes per canonical day. An existing world's day and time of day carry over (checked on a copy of the live DB).
- The world can be frozen separately from River's thinking (`W` key / freeze button).
- Not yet done: no persisted activities, so a restart still drops in-flight sleeps and timers; one-shot callbacks are closures.

## Post-cutover run (commit `307b96f`)

Same command, fixture and model as the baseline above: 77 calls (2 cycles), 939,153 input / 17,501 output tokens, 97.7% cache hits, about 1.9 million tokens per simulated day, 16 memories.

That is within run-to-run noise of the baseline (84 calls, about 2.0 million). As expected, the cutover changed timing, not token use: the brain is still cycle-driven. The token reduction is MVP 4's job. River ended in a different place in each run, so the two runs diverged behaviorally as usual for a live model.
