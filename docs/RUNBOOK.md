# Recovery runbook

Everything here is rehearsed by a script or test; the name is given. Paths assume the repository root. The live database is under `data/`; never run experiments on it.

## Resource limits (checked by `npm run unattended` and `tests/unattended.test.ts`)
Three simulated days, unattended, mock brain, one island: peak memory ≤ 700 MB, p95 tick ≤ 10 ms, ≥ 100 ticks per second (10× real time), database growth ≤ 25 MB per simulated day,
log rows ≤ 25,000 per day, no sandbox process left running. Measured on the development machine: about 13,000 ticks per second, 213 MB, p95 tick 0.09 ms, 1.5 MB per day.
The sandbox limits per plugin run are in `docs/PLUGIN_SDK.md`.

## Back up (any time, while running)
`npm run db:backup` takes a consistent copy (SQLite `VACUUM INTO`) and verifies it opens. Keep the copy somewhere other than `data/`.

## Upgrade or convert a database: rehearse first
1. `npm run migrate:legacy -- <database> [outDir]` backs the database up and proves the backup restores to the same bytes, converts a **copy**, boots the copy and runs it,
   checks the invariants (item audit clean, every grant kept and none invented, entities kept, every migration applied), confirms the original is byte-for-byte unchanged,
   and rehearses the rollback. It writes `report-*.json`. Read the report's `notes` and `forged` sections.
2. Only if it passes: stop the server, take a final backup, run the real conversion (the server applies migrations itself on start), start it, and watch the log.
   Migrations run once each, in order, inside a transaction, and are recorded in `sim_migrations`.

## Roll back
Stop the server. Put the backup file back where the database was (`cp backup.db data/river.db`, and remove `river.db-wal` and `river.db-shm`), start the **previous** version.
History made after the cutover stays in the newer database; it cannot be merged backward. `scripts/migrate-legacy.ts` rehearses this step and checks the restored bytes.

## After a crash
Start the server. It resumes from the last committed tick (one transaction per host turn together with the clock). Work that was running is marked interrupted. A command whose id the server
has seen is acknowledged as a duplicate and not run again. `npm run crash-test` kills the server with SIGKILL after acknowledgements and checks nothing acknowledged was lost.

## A plugin misbehaves
`GET /api/plugins` shows each plugin's status, hash and capabilities, and the sandbox counters (runs, timeouts, crashes). A timed-out or crashed run changes nothing and tells River it did not work.
To switch one off, remove its file (built-in) or reject it in the Tools tab; to change what it may do, edit the source and install it again.

## The world is wrong and you want to see why
`GET /api/timeline?object=…&chain=…` and the Brain tab. To watch a recorded life without touching anything: `npm run replay:serve -- <recorded.db>`.
To check that a recording still reproduces: `npm run replay -- <recorded.db>`.

## The client and server disagree
Every broadcast carries a sequence number and the first message names the protocol version. A client that sees a gap asks for the whole state (`resync`); a client on an older protocol is told to reload.
`npm run protocol-test` checks this against the real server.

## Was the run open-ended? (behaviour report)

`npm run behaviour -- <river.db> [more.db ...] [--json]` reads a database read-only and reports what River did: how varied its activities were (0 = one thing, 1 = even), the longest repeat and repeating-loop share, how many days passed with nothing new tried, desires set and finished, what it made, moments and emotions, what woke its mind and the tokens that cost, and its lives and how they ended. It ends with warnings (Narrow, Stuck, Cycling, Struggling, Plateau, Aimless, Unfinished, Passive). `npm run soak` prints a one-line version per seed. The mock brain is narrow by design, so judge a change by comparing two runs of the same kind, not by one run's warnings.

## Save slots and branches

A slot is a complete, named copy of the world in `data/slots/` (a database file and a small description beside it). Save one from **Controls → Save slots**, or `npm run slots -- save data/river.db "before the storm" "a note"`; `npm run slots -- list` shows them. Putting one back needs the server stopped: `npm run slots -- load "before the storm" data/river.db --force`. The copy is taken through a second read-only connection, so saving while River lives is safe.

To branch from an earlier moment of a recorded life: `npm run slots -- branch <recorded.db> <tick> "what if"`. It restores the recording's boot snapshot, replays its commands up to the tick, checks the last checkpoint matches the recording, and saves the result as a slot. Start it on its own with `RIVER_DB=data/slots/what-if.db PORT=8788 npm start`; it begins its own recording and goes its own way. The original is only read.

## Time-lapse: watching a recorded life

`npx tsx scripts/replay-serve.ts <recorded.db> [snapshotTick] [port]` shows a recording in the normal client (read-only; no model or network). The bar at the top has play/pause, speeds up to 512× (a world day in a few seconds), a scrubber that jumps ahead by running the same ticks flat out (a replay cannot run backwards: to go earlier, start it again), and **Route**, which draws the path River walked, shaded from night-blue to day-gold. The same route is available in a live world with the route button or `R`. `REPLAY_SPEED=64` sets the starting speed. `npm run replay:serve-test` checks it, including the jump.

## Content packs

A pack (`src/server/packs/<id>.ts`, listed in `packs/index.ts`) is a set of strange happenings and the library books that go with them, each written after something from stories or psychology; the file says what it draws on. The world's director draws from the built-in happenings and from every pack switched on in **Settings → Content packs** (`zone`, `mind`, `all` or `none`), shaping the choice by tone (contrast with River's heart) and theme (no repeats). Shipped: **zone** (an iron hatch with a number ring, a cork float with a face, a doorframe in the grass, a path that has moved, ferns grown in a ring, a signal under the ground; after Stalker, Lost, Annihilation, the Backrooms, Cast Away) and **mind** (deja vu, River's own footprints, faces in bark and stone, an unfinished cairn, a step that is not there, a deer that is too still, a seam in the sky, a late echo; after the doppelganger, pareidolia, the Zeigarnik effect, the Mandela effect, the uncanny valley, The Truman Show).

Rules for a pack: a happening only describes what River perceives, never what to do, what it means or what it is worth (a test rejects instruction-like words); it must be safe to run when its landmarks are missing; names are unique. Adding a pack changes which happenings the director can draw, so a recording made before the change will not replay exactly after it.

## Content packs for the physical world

`src/content/packs/<id>.ts` holds materials, kinds of thing, recipes and **deposits** (where the raw stuff is found on the island) as plain data, listed in `src/content/packs/index.ts`. `items.ts`, `materials.ts` and `recipes.ts` add a pack's part when they load, and `world.ensureMaterials` seeds its deposits (once per island, the same way every time for a given seed). A pack cannot replace anything that exists. What a new thing can do still comes only from its materials and shape (a test checks the ladder), so a pack cannot add a capability by describing one. Shipped: **handwork** (reed beds and copper seams; a stone knife and axe, a reed basket, a fired clay pot, copper ingots smelted beside a fire, a copper knife). Recipes appear in River's `craft list` as soon as the pack loads. River's own plugins in `src/server/plugins` are not part of the release: commit with explicit paths, not `git add src`.

## Visitors

Every few world days (`visitorDays`, 0 = never) a stranger comes ashore in daylight, walks toward River, stays ten to twenty minutes and goes. Four archetypes in `src/content/visitors.ts` (peddler, castaway, child, hermit), each after something from stories, with their own wants, goods and lines. River reaches them through two gated tools: `speak_to` (they answer) and `trade` (give one kind of thing for something they have; `want: list` says what they have and value). Values are theirs: a hermit prizes books and lamps, a child shells and flowers, and trust brings a small discount. They never explain the island or set a goal, and River may ignore them.

Cost: their bodies, trades and scripted lines are deterministic and free. If `visitorVoice` is above 0 (default 12 a day) and a model is set, `speak_to` asks it for their reply first (a short prompt, 110 tokens out, the routine model if one is set, at most 6 per visit); the answer is journaled with the command like a web search, so replay is exact. Out of budget, or with the mock brain, they speak their own lines. Relationships go through the same attachment system as animals (kind `human`), and are forgotten on a new life.
