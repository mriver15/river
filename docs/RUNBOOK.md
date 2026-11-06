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
