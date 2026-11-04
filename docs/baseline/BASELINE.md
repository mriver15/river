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

## MVP 3: activities, navigation and reflexes

What exists:

- **Persisted activities** (`src/server/activities.ts`, table `sim_activities`). An activity is data: definition id and version, a step, a progress record, reservations, a deadline. No closures or promises are stored, so `resume()` after a restart picks it up. One runs at a time; starting another interrupts the current one. Definitions: `travel`, `rest`, `gather`. Each step is small and deterministic, with explicit durations (a harvest takes 3 simulated seconds per unit).
- **Reservations.** `gather` sets aside stock on the source (`props.reserved[activityId]`) so nothing else counts it as free; each unit taken consumes one reservation; ending or cancelling the activity releases only what was not consumed.
- **Navigation** (`src/server/nav.ts`). A* on a 1 m grid, eight neighbours, no corner cutting, stable tie-breaks, then string-pulled. It avoids only obstacles River *knows* about, so an unseen obstruction is discovered by walking into it, which triggers a replan. The same inputs always give the same route.
- **Known world** (`src/server/knowledge.ts`, table `known_entities`). Everything within sight, each tick, becomes known. Tool lookups by id or name (`findEntity`) and activity targets only see known things, so a guessable id no longer reveals an unseen object. An existing world is seeded with what is within 60 m of River.
- **Reflexes.** Each tick the body senses fire within 4.5 m, a wound, a charging predator and a collapse. An activity lists which of these stop it; a rest is always stopped (and River woken) by fire, injury or a predator. A predator or an attack also starts an instinctive escape: a short run directly away, without a model call, immune to being stopped by the thing it flees (setting `Instinct to flee`, on by default).
- **Brain tools.** `move_to` and `rest` now start activities and wait for them; new `gather` (do a whole errand in one call: walk, take each unit, move to another source if one runs dry, optionally come back) and `stop`. If the process restarts mid-errand, the activity continues and River is told when it ends. A human can cancel with the new Stop button (`activity_cancel`). The activity shows with progress in the activity chip.
- **Commit-per-tick state.** River's body and the walk in progress are committed with every tick (they were saved every 5 s), which is what makes a copy of the database a faithful point to resume from.

Results:

| Check | Result |
|---|---|
| `tests/activities.test.ts` (8 tests) | gather three and return with zero model calls; depleted source gives partial completion; fire interrupts rest and wakes River; cancel releases only unconsumed reservations; a new life cancels the work; routes go around known obstacles, fail when the way is shut, and ignore unseen ones; unseen things cannot be targets; a charging predator stops the errand and River runs |
| `npm run restart-test` | a copy of the database taken mid-activity, resumed in a **fresh process**, finishes identically (River, entities, inventory, activity table) at 7 cut points: walking out, mid-harvest, second source, harvesting, returning, and two points in a rest |
| `npm run soak -- 20 3 4` (mock brain, now also using `gather`; a reset and an approval in every seed) | all 20 exact |
| `SOAK_LIVE=1 npm run soak -- 3 3 3` (real model) | all 3 exact |
| `VERIFY_LIVE=1 npm run verify:replay -- 300 new-life` | exact; River used `move_to`, `rest`, `gather` |
| `npm run crash-test`, `npm test` | pass; 26 tests |

Bugs found while building it: a harvest began while the outbound walk was still running, so its stale "arrived" result ended the return leg at once; an escape was cancelled on its first tick by the predator it was fleeing; a reset's generation bump was not journaled, so a running activity was fenced at different ticks live and in replay; the brain's context-building wrote to the known-world table, which replay cannot repeat.

### MVP 3 leftovers, completed afterwards

- **Faithful mid-run snapshots, with the whole world alive.** A registry (`src/server/persist.ts`) commits each system's in-memory state with the clock: emotions (including the queued "moment"), ambient director schedule, wildlife behaviour modes, creature trust, wounds and the body's small memories, fire and story throttles, world timers, the walked-path and burnt-ground grids (as raw floats), animals' positions, and River's whole state (activity label, speech, sleep deadline). It is written at the commit, after every system has had its say that tick. Two timers that were closures (ambient "relief" and "rustle", the emotion moment) are now persisted jobs (`scheduleJob` / `onJob`), so they fire after a restart exactly when they would have.
- **`npm run restart-test`** now includes a *living* world (weather, ambient events, wildlife, predators, a death): copied at three different moments, restarted in a fresh process, and run on: the full state hash (rng, entities, River, world, creatures, emotions, body, journaled tables) matches every time.
- **Crafting, building, music, sewing, pigments and first aid as timed work.** A tool validates and calls `gate(w, ms, label)`; the first pass stops before anything has changed and a persisted "work" activity holds the wait as a deadline. When it ends the tool runs again with the gate open, re-checks everything and applies it. Materials are therefore spent only at the end, an invalid recipe fails at once and costs nothing, danger stops the work with the materials intact, and a restart mid-work finishes it. Crafting now takes 3 s and building up to 45 s of world time (they were instant). Music is counted once, and its effects land at the end.
- **Rest is interrupted by sudden noise and by a human speaking** (thunder, a lightning strike, a voice); walking and gathering are not.
- **Reflex distances and harvest time are settings** (Instincts group): fire radius, charging-animal radius, how far River runs, seconds per unit.
- **Replay appraises a tool call by how it went live** (its recorded success and result), because some results depend on things replay cannot reproduce (memory, web).

Bugs found: River's body was saved mid-tick, before later systems changed it, so a restart could resurrect a stale value; the hash read the creature table, which is now written at commit; the knowledge set was updated from the brain's context-building.

Checks now: 31 unit tests pass; restart suite 12 scenarios exact (gather at 5 cut points, rest at 2, craft at 2, perform at 2, living world); 20-seed mock soak exact; crash test passes; real-model soak 3/3 exact in the latest runs. One earlier real-model run (of 3) diverged once, in the emotions hash at simulated tick 17,400; it did not reproduce in the next two real-model runs (7 seeds) after replay was changed to appraise tool calls by their live outcome, so the cause is not proven.

Still not done:

- **Other timed tools** keep in-memory waits: fire (burn, light, tend), the wildlife defend and fish tools, and the dozen plugins (dig, draw, inscribe, weave, ...). A restart during one of those loses that action (nothing is spent twice; their materials are taken after the wait). Converting them is the same one-line change (`gate` plus `timed`), but each needs its mutation order checked.
- **Vertical navigation** (towers, ladders): the grid is flat; bridges count as walkable.
- **Inventory capacity** does not exist in the game, so `gather` has none to check.
- **Learned routines and a general planner:** out of scope by design.
- **In-flight appraisals:** an emotion appraisal that is waiting on an embedding at the instant of a restart is dropped (it is derived from a tool result that was already committed).

## MVP 4: the event-driven brain

Design and rules: `docs/DECISION_PACKET.md`. Code: `src/brain/` (trigger queue, packet assembly: pure and unit-tested) and `src/server/agent.ts`.

What changed:

- **Decisions are woken by triggers, not by a timer.** Danger, a human's words, a need falling (with hysteresis), an activity that failed or ended with nobody waiting, a strong feeling, something perceived, and a quiet moment, each with a priority, expiry, merge key and minimum spacing. Everything eligible is answered by one decision, most urgent first.
- **Fresh compact packets, no growing transcript.** Each decision is shown a bounded summary (state, observations, memories) built from budgeted sections; danger and a human's words are never cut. A decision makes one or two model calls (information tools allow one follow-up; any action ends the decision), may contain several actions in one reply, and stops at the first that fails. What was just done and how it went is carried into the next packet.
- **Accounting and budget.** Every model call is tagged by consumer (decision, reflection, dream, story, forge) with tokens in/out/cached and latency; each decision is logged (`brain_decisions`) and shown in a new **Brain** tab. The last 20% of the hourly allowance is reserved for danger and a human; when it is spent the world either waits at the next decision (default) or carries on without new ones. Activities and reflexes continue either way; River is not put to sleep for want of budget.
- **Reflection** now follows experience: enough importance since the last one, or a maximum interval (default 45 world minutes), never more often than every four decisions.
- **Cancellation.** In-flight model calls are aborted on a new life or reset; late answers are discarded.
- **Outside services are journaled.** `recall`, `web_search` and `web_fetch` fetch first, and the answer travels with the command, so the action is a pure function of it. (Found when real-model soaks diverged by half a second in one emotion timestamp: the embedding lookup finished a few ticks after the call began live but instantly in replay.)
- **Deterministic action summaries.** The old loop saved a model-written summary at the end of every long cycle; the new one keeps a memory of what was actually done (successful, non-trivial actions), written without a model call.

### Token measurement

Same fixture (`new-life`, the same island), same model (`deepseek-flash`), same 12 wall minutes at 1x (0.5 simulated day), `npm run baseline`. Baseline = the two MVP 0 / pre-MVP 4 runs. Live-model behaviour differs from run to run, so this is a small sample, not a confidence interval.

| Run | Tokens | Tokens per simulated day | Model calls | Actions | Tokens per action | Memories |
|---|---|---|---|---|---|---|
| baseline 1 | 1,010,571 | 2,021,142 | 84 | 85 | 11,889 | 14 |
| baseline 2 | 956,654 | 1,913,308 | 77 | 79 | 12,109 | 16 |
| MVP 4 (a) | 398,849 | 797,698 | 97 | 103 | 3,872 | 21 |
| MVP 4 (b) | 544,151 | 1,088,302 | 135 | 157 | 3,465 | 22 |
| MVP 4 (c) | 384,665 | 769,330 | 96 | 99 | 3,885 | 23 |

- **Per simulated day: mean 885k against 1.97M, a 55% reduction** (range 45% to 61% across the three runs, so one of three did not reach the 50% target). **Per action: 3.7k against 12.0k, a 69% reduction.** Average input per call fell from about 12k to 3.8k tokens: the old cost was the conversation growing across a 40-call cycle.
- **Activity went up, not down:** 99 to 157 actions in the 12 minutes (against 79 to 85), and more memories. This depends on the setting `followUpSeconds` (pause after acting, default 2 s). An earlier configuration that applied the 8-second quiet-moment pause after every decision measured 150k to 272k tokens per simulated day (a 86% to 92% reduction) but River took only 25 to 48 actions in the same time: cheaper because it acted less. The setting moves along that tradeoff; the default was chosen to keep River at least as active as before.
- **Provider and behaviour variance is large** (the six MVP 4 runs ranged from 150k to 1.09M tokens per simulated day depending on how far River chose to walk and how often it was woken). Not measured: a controlled comparison on matched seeds with a fixed action script, and missed critical interruptions in live runs (no run met a lethal threat; the scripted tests cover the priority and latency behaviour).
- Decisions averaged 1.6 calls and about 7 seconds of model latency; the packet averaged 700 to 800 tokens on top of about 2.9k fixed tokens (system prompt and tool list).

### Tests

`tests/brain.test.ts` (queue, merging, expiry, spacing, hysteresis, packet budgets, critical items kept) and `tests/decisions.test.ts`, which runs the real agent against a scripted local model: no model call while an activity runs; a threat and a human voice are taken first whatever the arrival order; the packet stays within its budget and is a fresh two-message summary; an action ends the decision and the call limit holds; several actions in a reply run in order and stop at the first failure; a failing provider is retried without doing anything twice; a late answer from a previous life changes nothing; an empty allowance holds ordinary decisions back, still lets a human through the reserve, and freezes the world only if told to; a need that stays low wakes the mind once.

Not done in MVP 4:

- No small-model or cheaper-model path for routine decisions (the spec's explicit exclusion: deterministic procedures are the first answer).
- Delta packets: every packet is a full compact baseline. Providers' prompt caching is used opportunistically, never relied on.
- Embedding model and version are not pinned in the recorded relevance scores.
- Tool descriptions (about 2.1k tokens per call) are sent whole every time; trimming or offering only relevant tools would save more but changes what River can discover.
- A human's words wait for the current action to finish rather than interrupting it (a rest and a walk's own reflexes excepted).

## MVP 5: persistent objects and mechanical crafting

Code: `src/content/` (materials, item definitions, recipes: pure and tested), `src/server/items.ts` (the registry), `src/server/crafting.ts`.

What changed:

- **Every item is an instance** with one identity, a definition (`id@version`), a quantity, a condition (durability, wetness, temperature), the materials and mass it is actually made of, a provenance (when, by whom, from what), a visual record (recipe id, seed) for MVP 6, a lineage, and exactly one location: the ground, River's hands, a body slot, inside another item, or consumed (with the event that consumed it). The registry is the single authority; `World.inventory` and the item entities on the ground are projections it keeps in step, and the old `addItem` / `takeItem` / `findItem` API is an adapter over it, so the 110 existing call sites did not change.
- **Moving a thing keeps it what it is.** Picking up, putting down and wearing keep the same id, condition and provenance. Putting down part of a stack makes a child with lineage (`splitFrom`); picking it back up folds it into the stack and records `mergedFrom` / `mergedInto`. Naming or inscribing a thing makes it its own (it stops stacking). Worlds from before this existed are adopted once, with their origin marked *unknown*, not invented.
- **Materials and capabilities.** Eight starting materials (wood, stone, bark, moss, hide, clay, charcoal, pigment) plus inert ones for what already existed (food, shell, glass, metal, paper). What a thing can do (burn, bind, cut, pierce, hold, insulate, be a shaft...) is derived from its materials and shape by versioned rules, never from its name or description. An unknown kind gets an inert definition. A broken tool does nothing.
- **Recipes and assemblies.** `sharpen_stick`, `spear` (shaft + head + binding, mass budget and part limits), `cord`, `basket`. Parts are matched by capability, so a "perfect rope" that is really a keepsake does not bind. Everything is checked first and changes nothing if it fails; a valid recipe uses up exactly the declared parts (tools are worn, not used up), conserves mass (the product weighs what went into it), stores what it was made from, and scales its stats (a spear's damage and reach) by the parts' condition with a small seeded variation. The free-text `craft` now follows a recipe (`list` shows them) or makes a **keepsake**: it can be called anything, and the world is honest that it does nothing a pile of its parts could not.
- **Containers and equipment.** Baskets hold up to a mass; `stow` / `take_out`; a container cannot hold itself or be nested in a loop; if it is used up what was inside lands where it was, neither lost nor doubled. Worn clothing is now simply the garments in River's body slots.
- **Fire and wear.** Only things made of fuel burn, a soaked one resists, and the ash left is at most a fifth of the mass that burned. Weapons wear when they hit and break at zero.
- **Item inspector.** The Items tab shows what each carried thing is (materials, mass, condition, what it can do, where it came from, how it was split or joined); `/api/item?id=` gives the full record and history; River's own `inspect` states the same facts, nothing else.
- **Audit.** `registry.audit()` proves the invariants (one location per item, no loop, capacity, whole positive quantities, projections in step); it runs at every replay checkpoint and the soaks fail if it ever reports a violation.

Bugs found while building it: the record of a merge was kept in memory but never written (found by the lineage test); condition drift was in memory only until something else touched the item (found by the restart test); a fixture gave a deer a trait the game does not have, which made trust NaN, which silently ended recordings early (the state hash refuses non-finite numbers) — the game now treats an unknown stored trait as "curious" and clamps trust.

Tests: `content`, `recipes` (pure), `items` (migration from a pre-items world, identity through pickup/drop/equip, split and merge lineage, naming, invalid recipes touching nothing, exact consumption and mass conservation, descriptions granting nothing, keepsakes not standing in for parts, fire and ash, taking a structure down, container limits and loops, reset); 70 tests pass. The restart suite gained an `items` scenario (13 scenarios, all identical). The 20-seed mock soak (the mock brain now also drops and picks things up) and the 4-seed real-model soak replay exactly with a clean item audit.

### MVP 5 leftovers, completed afterwards

- **Staged construction.** A build is now a persisted `construct` activity in three stages. Each stage takes time and spends its share of the materials when it finishes, so nothing is spent for unfinished work. Stopped part way (by hand, by danger, by running short), what stands is an *unfinished structure* that holds exactly what was put in, is drawn only as high as the work done, gives no shelter and cannot be walked on; `build continue` finishes it for exactly the rest (and says what is still missing). The plan travels with the activity and the structure, so a restart mid-build resumes it.
- **Dismantling follows declared rules tied to what is really there.** An unfinished structure returns 85% of what is in it (it was never fixed together), a finished one 60%, and one that burnt returns the non-fuel it was made of (stone, clay, chalk) at 60% plus ash for the wood: at most a fifth of the wood's mass, and none of the wood itself. Never more than went in.
- **Another recipe and room as well as strength.** `hide_pouch` (a hide and a cord). Containers now also have a volume (a basket about 10 litres, a pouch 2.5), and a rigid rod longer than a container's biggest side will not go in (a strip can be coiled). A basket cannot go inside another; a pouch can.
- **Temperature has a use.** Things near a fire warm toward it; stone and clay keep the heat for a long while, wood and bark give it up quickly. A hot stone in River's pack (or a roasted thing, or a glowing coal) adds a little warmth, capped well below a fire's, and fades as it cools. Condition changes are written when they happen.
- **Better provenance.** Pigments record what they were ground or mixed from; roasted food records what it was cooked from (and starts hot); an ember is recorded as drawn from a fire; things the human places or gifts are recorded as such rather than "unknown". Container contents now appear in the model's picture of what River carries.

Checks, run narrowly rather than as the full regression: 79 unit tests (new: `building`, heat, container limits, provenance, the pouch recipe); the restart suite with two new staged-build scenarios (restart after one stage paid for, and after two) plus items and crafting, all identical; replay of two fixtures and a three-seed one-day soak, exact with a clean item audit. The full 20-seed and real-model soaks were not rerun for these changes.

Still not done:

- The first-pass recipes are few (five). Sewing, building and the pigment tools keep their own rules (they are recorded, but are not recipe-driven), and plugin-made items carry only the information their plugin supplies.
- A structure does not weather or wear: its recovery depends on its state (unfinished, finished, burnt), not on age or storms.
- Temperature still only matters for warmth; a hot thing does not ignite what it touches.
- The visual record (recipe id, seed, colour) is stored and stable, but nothing draws from it until MVP 6.

## MVP 5 leftovers, round 2

Done since the section above:

- **Hot things ignite.** A glowing coal or an ember carried in or dropped next to dry fuel can start a fire; wet fuel does not catch. Fuel value comes from the material and its wetness, not from the name.
- **Structures weather, can be repaired, and can collapse.** Integrity falls with age and storms (`weatherStructures`, run with item upkeep), `repair` restores it, and a structure that reaches zero collapses into salvage. Dismantling yields scale with integrity.
- **More recipes on the one recipe engine:** flute, clay bowl, and the eight garments (sewing now goes through `sew_<garment>` and `checkRecipe`/`craftNow`, not its own rules). Recipes can require a fire nearby (`place`), derive properties from inputs (`derive`), and be reached only through another tool (`via`).
- **Capability honesty.** A flute sounds because it is hollow and wooden, not because it is called one; `strip_bark` needs a tool that cuts by material; the lens plugin takes any stone, not only ones with a stone-like name. A shaft must be a slender wooden rod.
- **Containers have volume as well as mass**, and rigid long things do not fit in small ones. Bowl, pouch and basket are real containers; a woven basket holds things.
- **Heat retention by material:** coals stay hot and warm the carrier a little; wet and cold things drift to ambient at their own rate.
- **Plugin-made items record provenance:** dig, lens, inscribe, pitch rods, strip bark and weave pass `{ sources, maker, note }` to `addItem`, so the item knows what it was made from and by whom. The forged-plugin cheatsheet (`smith.ts`) documents the options.

Checks run (narrow, by request): all unit tests (88 pass), typecheck, replay of `new-life` and `fire` fixtures, a 3-seed 1-day soak (all checkpoints matched, no network). The full 20-seed and real-model regression was not rerun.

Still not done:

- **Building and pigment tools are not recipe-driven.** Structure plans keep their own staged rules and pigments only record provenance.
- **The visual record** (recipe id, seed, colour) is stored and stable, but nothing draws from it until MVP 6.
- The earlier items about other timed tools, vertical navigation, inventory capacity, learned routines and in-flight appraisals still stand.

## MVP 6: consistent procedural 3D items

Code: `src/content/visuals.ts` (shared, pure), `src/client/renderers/` (Three.js), `src/shared/posture.ts`, `src/client/gallery.html`.

What changed:

- **One visual registry, keyed by `(recipeId, version)`**, shared by server and client. 24 recipes cover every item definition (stick, stone, spear/stake, bowl, bottle, cup, lamp, book, food (berry/mushroom/meat), pigment, garment, flute, basket, pouch, plank, hide, strip/cord, moss, fish, shell, flower, seed, lump, keepsake). No item falls back to the old glowing octahedron.
- **A recipe is data**: a short list of approved primitives (box, sphere, cylinder, cone, torus) with channels (primary, secondary, accent, metal, glass, glow). Every design is validated before use (at most 32 components, 3000 triangles, bounded sizes, finite numbers, no unknown fields such as URLs) and then **fitted to the definition's documented size**, so the drawn bounds equal the collision bounds by construction (and a test checks it for every definition).
- **Same look everywhere.** Each instance stores `{recipeId, version, seed, parameters}`; a split stack child inherits its parent's look; dyeing updates the parameters. The server sends one `VisualPacket` per item (ground entity, pack projection, worn garment), and the ground, the pack preview and the body all build from it.
- **Condition shows.** `lookOf` quantises wetness, char, damage level and heat; wet darkens and shines, char blackens, hot glows, damage hides intact parts and shows splintered or cracked ones, repair shows a fresh part. The ground entity is rewritten only when the look visibly changes.
- **Equipment sockets.** Garments are drawn on the body from `wornDesign` anchored at body/head/neck/feet sockets; Scene3D no longer carries its own garment geometry.
- **Fallback.** An unknown recipe or version, or an invalid design, draws a plain block of exactly the right size and logs a diagnostic; it claims nothing about function.
- **Resource reuse.** Unit geometries are shared; materials are shared and reference-counted and disposed when the last item using them goes; far items (past 32 m) are drawn from their major parts only. Items under 14 cm on screen are enlarged for visibility (`groundScale`, capped at 12x); the documented size never changes.
- **Preview component** (`renderers/preview.ts`): one shared renderer makes cached pictures of any item, used on the pack cards.
- **Posture.** `postureOf` turns feelings, needs and body state into four bounded channels (tension, gaze, gait, slump); River's body leans, lifts or lowers its head, braces its arms and changes stride, eased over time. It reads the simulation and never feeds back into it.
- **Gallery fixture.** `gallery.html` draws every definition in eight conditions, every garment dyed in the pack, worn on a body in three conditions, and the fallback. `npm run gallery:shots` builds the client and writes one screenshot per section with headless Firefox (`.fixtures/shots/`).

Checks: typecheck and build clean; 115 unit tests (the new ones cover recipes, sizes, budgets, hostile designs, determinism, condition looks, transfer/reload parity through the registry, ground sync, posture); short replay, 2-seed soak and the restart scenarios for items/build/alive pass. Screenshots were reviewed by eye; there are no pixel-diff baselines.

Still not done:

- **Screenshots are not compared automatically.** They are produced and inspected; sizes, budgets and condition rules are what the tests assert. Pixel baselines would need a fixed GPU/driver.
- **Held items.** There is no "in hand" socket yet: River is not shown holding or wielding anything; only garments are placed on the body. The recipes define grip/mouth/tip sockets for when a mechanic needs them.
- **Damage on worn garments** is not drawn (the worn designs have no damage parts); wetness and dye do show.
- **Repair of ordinary items** has no mechanic, so the repaired look is reachable only through `props.repaired`.
- **Structures and creatures** keep their existing hand-written meshes; they are not in the registry.
- **Custom (River-designed) items** use the same validated component format, but no tool lets River author one yet.
- Visuals for items made by forged plugins use the definition their kind maps to (the keepsake for unknown kinds).

## MVP 7: causal emotions, attachment and beliefs

Code: `src/mind/` (pure: `appraisal`, `perception`, `links`, `beliefs`), `src/server/inner.ts` (the service), `src/server/emotions.ts` (appraisal and decay), `src/client/ui/heart.ts` (inspector, in the Brain tab), `GET /api/mind`.

What changed:

- **Perception boundary.** A loss is a typed event with a stable id and a signature (place, loudness). River observes it only if it is in sight range (which the dark, fog and storms shrink), awake, or loud enough to hear; heard-but-unseen leaves a small unease and the subject stays unknown. Anything else is kept as *unseen* and appraised only when River comes upon the place (`discover`) or is told. Each observation records modality, confidence, tick and whether it was found out late. Nothing that burns out of sight causes grief before it is found.
- **Appraisal factors** (`appraiseAmount`, pure): novelty/habituation, relevance, attachment, expectation error, controllability (for threats), responsibility (for losses), vulnerability (hungry, tired, cold), and arousal carry-over. Relevance now comes from explicit links (words shared with desires, interests and named places, and attachment to the subject). Embedding relevance is an optional journaled *annotation*: it can only add a little to the same feeling when it arrives, at the tick it arrives, so how long the service takes cannot change any earlier tick. Duplicate events (same id) are never appraised twice.
- **Decay and sanity.** Decay is by half-life in simulated seconds, never negative or non-finite; loneliness has no half-life and is eased only by its causes. Habituation keys carry event class and subject, and force returns over simulated time (about 0.8 of fresh after eight hours).
- **Explanations.** Every change to a feeling records cause event, prior value, factors and multipliers, delta and result (`mind_trace`). Changes under 0.02 are summed into one line per simulated minute; the `traceAll` setting keeps each.
- **Relationships.** Per subject (creature, item, place, structure): familiarity, trust, attachment, fear, last encounter and up to eight pieces of evidence. Attachment grows from making (once), naming, using, caring, repairing and time spent together, with diminishing returns and cool-downs so repetition cannot be farmed; a name alone is not love. Stock items (fungible) never attach. A creature's trust of River stays separate from River's attachment to it.
- **Loss severity** depends on the link: what such a thing is worth to anyone, plus half of River's attachment, scaled again by attachment. Mending something raises attachment, eases grief for it (but leaves some, and some longing: a mended thing is not quite the old one) and adds pride; finding something thought gone eases grief and surprises. Items can now be repaired (`ItemRegistry.repair`), which also shows the "repaired" look from MVP 6.
- **Beliefs.** Claims with confidence, supporting and contradicting observation ids, and a fact/hypothesis kind. River expects what it built or put down to be where it left it; a loss it observes contradicts that, and the expectation error makes the grief land harder. The same observation never counts twice.
- **Behaviour.** Memories made while the heart is stirred get up to two points of extra importance. Attention weights (`w.attention`) bring loved or surprising things forward in what River is told about nearby. Interruption tolerance (0.5..2) scales how long minor triggers (completion, emotion, novelty, idle) wait; threats, a human voice and needs are never delayed. None of this grants information or sets goals; low fear cannot disable a reflex.
- **New life** clears links, beliefs, unseen events, observations, pending annotations, seen ids and the trace table.
- **Fixtures.** `tests/fixtures/appraisal.json` holds golden amounts for seven scenarios, so a coefficient change is deliberate and visible.

Checks: typecheck and build clean; 141 unit tests (pure appraisal, perception, links and beliefs; runtime tests for each acceptance line: unseen destruction, personal vs stock loss, repair, rediscovery, duplicates, habituation, late annotation, tracing, new life, restore); replays of `new-life`, `fire` and `injury`, a 3-seed 1-day soak and the build/items/alive restart scenarios all match. The full 20-seed regression was not run. One existing test (`activities`) was reordered so a burning tree from the previous test is removed before the body is reset.

Still not done:

- **Occlusion** is not modelled (only range, light, sleep and loudness), and discovery is by coming within sight of the place, not by seeing remains, absence from a known spot, or a human telling River (`discover(id, "told")` exists but nothing calls it).
- **Only losses, repairs and rediscovery are typed events.** Other appraisals (sounds, discoveries, tool outcomes) keep their existing text rules but now carry factors, ids and traces.
- **Mixed feelings** are produced for mending and rediscovery only; betrayal and successful care outcomes for creatures are not yet separate events.
- **Disposition** (slow learned caution and confidence) and a separate valence/arousal/control layer are not implemented; the existing valence and arousal are derived from emotion levels.
- **Fear association** is stored but nothing raises it yet.
- **Memory salience** is a bounded boost to importance; it does not yet affect recall ranking.
- **Item repair** has no tool for River to use; only the registry method and structure repair exist.
- **The relevance annotation** was exercised in tests with injected results, not against a live embedding service in this phase.
