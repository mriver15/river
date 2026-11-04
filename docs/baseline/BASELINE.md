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

## MVP 2 progress: record and replay

What exists:

- **Command journal** (`sim_commands`): every brain tool call, brain-loop effect (end of cycle, activity labels), human command that changes the world, and outside input (a dream's outcome, each embedding relevance score), with the tick it was admitted on.
- **Boot snapshot** (`sim_snapshots`, `data/snapshots/`): the database file exactly as the process found it, taken before anything is constructed. Construction and hydration are repeated by replay, so they must not be in the snapshot.
- **Checkpoints** (`sim_checkpoints`): a hash of the physical state every 300 ticks, in named parts (rng, entities, inventory, me, world, heat, scorch, creatures, body) so a mismatch says where it diverged.
- **Replay** (`npm run replay` is `tsx scripts/replay.ts <recorded.db>`): restores the snapshot, reruns the journal at the recorded ticks through the same runtime (`src/server/runtime.ts`), and compares every checkpoint. `fetch` is blocked, and the run is offline.
- **Verification** (`npm run verify:replay -- <seconds> [fixture...]`): records a run of each fixture with human commands, then replays it.

Results on this machine:

| Run | Commands | Checkpoints matched |
|---|---|---|
| Mock brain, all 6 fixtures, 45 s each at 10x | 74-200 each | 18/18 each |
| Real model (`deepseek-flash`), embeddings off, 240 s at 10x | 124 | 96/96 |
| Real model, real embeddings (Ollama), 240 s at 10x | 136 | 96/96 |

Bugs this found: partial `needs` in my fixtures produced NaN (the hash rejects non-finite numbers); system construction repeated on a post-construction snapshot drew random numbers twice; brain-loop side effects, dream mood shifts and embedding-driven appraisal were unjournaled inputs.

### MVP 2 completion work

Added after the first slice:

- **Idempotency.** Every client message carries a `cid`. A cid the server has seen is acknowledged as `duplicate` with the original outcome and is not run again (unique index on `sim_commands.command_id`). Tool calls are keyed `generation:tool_call_id`.
- **Lifecycle fencing** (`src/server/lifecycle.ts`). A life generation advances on reset and on death. Model replies, tool calls, reflections, dreams, stories and embedding appraisals remember the generation they started in and are discarded (and logged) if it has changed.
- **Durability.** One SQLite transaction per host turn: the writes of the ticks, the continuations between them, commands that arrived, the journal rows and the clock itself commit together. Acknowledgements and broadcasts wait for the commit. `PRAGMA synchronous=NORMAL` with WAL: a process crash loses nothing committed; a power cut can lose the last few commits.
- **Injection queue** (`sim.inject`). Brain actions, model answers and embedding scores enter the world at tick boundaries, one at a time, with the event loop drained after each, the same order replay applies the journal in. Without it, 12 of 20 soak seeds diverged by a tiny amount in `mood` after long stretches of exact matches: independent async chains interleaved by timing.
- **Snapshot naming.** Boot snapshots are named per database. Before, parallel worlds overwrote each other's `snapshot-0.db`, so a replay could restore another world.
- **Lifecycle boundaries.** `reset_river` and `new_life` are journaled; replay covers the segment before the first one.

Results:

| Check | Result |
|---|---|
| `npm run soak -- 20 3 4` (20 fresh seeded islands, 3 simulated days each at 100x, mock brain, human commands, 4 at a time) | all 20 replayed exactly (150-162 checkpoints each) |
| `npm run crash-test` (3 SIGKILLs right after acknowledgements, 75 acknowledged commands) | none lost, none duplicated, clock and journal agree, integrity ok, retries after restart recognised as duplicates |
| `npm run verify:replay -- 45` (6 fixtures) | all exact |
| `VERIFY_LIVE=1 npm run verify:replay -- 240 new-life` (real model and embeddings) | exact |
| Unit tests (`npm test`) | 18 pass |

Closing items, done after the first completion pass:

- **Wider hash.** Checkpoints now also hash emotion state (levels, habituation, recent actions) and the tables written only through journaled paths (places, tunes, compositions, works, palette, opinions, lives, catalog, tool grants, moments). The 8-seed and then 20-seed soaks still replay exactly.
- **Replay across approvals and resets.** `approve`/`deny` go through the same path live and in replay. A reset journals the moment of the wipe (`reset_apply`), not the request, because the request waits for the in-flight cycle and the wipe can land ticks later. Replay applies the same wipe (`resetApply`). The soak now approves a tool request and resets the life in every seed (and the whole island in every third seed).
- **Backup names.** Reset backups were named to the second; worlds resetting in the same second collided and the later reset failed. Names are now per database and never overwrite.
- **Real-model soak.** `SOAK_LIVE=1 npm run soak -- 3 3 3`: 3 seeds, 3 simulated days each at 12x with the real model and real embeddings, 148-192 commands each, one reset and one approval each: 144/144 checkpoints matched per seed, no network calls in replay.

Results now:

| Check | Result |
|---|---|
| `npm run soak -- 20 3 4` (mock brain, resets and approvals in every seed) | all 20 exact |
| `SOAK_LIVE=1 npm run soak -- 3 3 3` (real model) | all 3 exact |
| `npm run crash-test` | pass (3 SIGKILLs, 75 acknowledged commands) |
| `npm test` | 18 pass |

What MVP 2 still does not cover:

- Power loss: the crash test uses SIGKILL. `synchronous=NORMAL` can lose the last few commits on a power cut.
- Forging a tool (a model call that writes a plugin file) and installing or rejecting forged tools are not replayed.
- Memories, desires and interests are not in the hash. The brain loop writes them (thoughts, reflections, which replay does not reproduce), so they cannot be compared. They influence the hashed state only through journaled actions.
- Mid-run snapshots are still not faithful: in-flight timers are closures. Persistent activities (MVP 3) remove this, and are the next step.
- Journal stories and reflections prose are not reproduced.
