# Release checklist

Each line is the completion checklist from the specification (17.3), with its evidence. "Open" means the evidence is not yet complete.

| Item | Status | Evidence |
|---|---|---|
| Every authoritative timer uses simulation time | Done | `every`, `after`, jobs in `sim.ts`; the audit in `docs/baseline/NONDETERMINISM_AUDIT.md` (`npm run audit`) |
| All random outcomes use persisted streams | Done, with one documented exception | `simRng`; plugin randomness is a pure function of (plugin, tick, arguments) and is journaled with the result |
| Tools/plugins cannot bypass command validation | Done | `tests/sandbox.test.ts`, `tests/writers.test.ts`, `docs/PLUGIN_SDK.md` |
| Snapshots include all pending work and version references | Done | `tests/engine.test.ts` (snapshot/restore), `sim_snapshots.param_set`, `npm run restart-test` |
| Late external results cannot cross lifecycle boundaries | Done | `tests/lifecycle.test.ts`, "a result for a life that has ended is fenced out" |
| Every physical object has one location and stable identity | Done | `tests/items.test.ts`, the item audit |
| Visuals and mechanics use the same item definitions | Done | `src/content/visuals.ts` reads `ITEM_DEFS`; `tests/visuals.test.ts` |
| River receives observations rather than global world events | Done for losses; open for the rest | `tests/inner.test.ts`; other appraisals keep text rules |
| Token savings measured with behaviour and latency metrics | Done | `docs/DECISION_PACKET.md`, `tests/decisions.test.ts`, the Brain tab |
| Every MVP acceptance criterion has evidence or a documented blocking failure | Done | `docs/baseline/BASELINE.md`, one section per MVP, each with its "still not done" |
| Original feature parity matrix is complete | Done | `docs/parity.json`, `tests/parity.test.ts` |
| Migration, backup restoration, reconnect and restart tests pass | Done | `tests/migration.test.ts`, `npm run migrate:legacy`, `npm run protocol-test`, `npm run restart-test`, `npm run crash-test` |
| Build/typecheck and appropriate simulation/visual checks pass | Done | `npm run typecheck`, `npm run build`, `npm test`, `npm run gallery:shots` |

Before releasing: run `npm test`, `npm run verify:replay -- 30 new-life fire injury`, `npm run restart-test`, `npm run crash-test`, `npm run protocol-test`, `npm run replay:serve-test`, `npm run unattended`,
`npm run soak -- 20 3 4` (the full soak; the last release was checked with 6 seeds of one day), and rehearse the migration on a copy of the live database.
