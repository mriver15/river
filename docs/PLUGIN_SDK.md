# Plugin SDK contract (version 1)

A plugin is a small TypeScript file in `src/server/plugins/` that default-exports a `ToolDef`. It never runs inside the engine. It runs in an
isolated process against a **copy** of what River perceives, and returns **proposals**. The engine validates every proposal and applies them
all at a tick boundary, or rejects the lot and changes nothing. The contract is defined once, in `src/server/sandbox/contract.ts`.

## What a plugin can read (`w`)
`w.me` (position, heading, needs, sleeping; frozen), `w.nearby(r)`, `w.entities` (the known entities within 80 m, at most 400),
`w.inReach(e)`, `w.dist(e)`, `w.compass(e)`, `w.findItem(ref)`, `w.canDo(itemId, capability)`, `w.timeLabel()`, `w.spotNearMe(d)` (to the nearest half metre),
`rand()` (a seeded sequence, a pure function of the plugin, the tick and the arguments), `wait(ms)` (virtual time, at most 60 s).

## What it can ask for
| Call | Capability | Checked |
|---|---|---|
| `w.addItem(kind, name, desc, qty, props?, opts?)` | `items.add` | quantity 1–99, sizes, `opts.defId` must be a known definition |
| `w.takeItem(id, qty)` | `items.take` | the item must still be carried, in that quantity, when it is applied |
| `w.putEntity(e)` | `entities.put` | the entity must still exist and be of a kind a plugin may change; props are plain data under 8 KB; the place must be on the island |
| `w.spawn(kind, name, x, z, props)` | `entities.spawn` | kinds the client can draw (not animals, graves, carcasses) |
| `w.removeEntity(id)` | `entities.remove` | must still exist |
| `w.bump({ energy, hunger, mood, curiosity, warmth })` | `needs.bump` | finite, within ±100 |
| `w.setActivity(text)` | `activity` | under 120 characters |
| `log(kind, text, data?)` | `log` | a known log kind |

Anything else on `w` (`w.fire`, `w.items.audit`, …) is not offered. A plugin that uses it is **disabled with an explanation** rather than half-working.
Imports are limited to `../toolkit.ts` and `../bus.ts` (`log`).

## Limits on one run
3 s of wall time (then the process is killed), 1 s of synchronous CPU, 64 MB of heap, 200 proposals, 4,000 characters of text, 96 KB of result,
60 s of virtual waiting. Exceeding any gives a typed failure and no change.

## What the isolation is
A fresh Node process per run, started with the permission model (no file writes, no child processes, no workers, no network), an empty environment (no API keys),
`--disallow-code-generation-from-strings`, and nothing readable but the runner. The plugin's code runs in a `vm` context with **no host objects**:
no `process`, `require`, `fetch`, timers or `eval`; data crosses as JSON strings. Worker threads are not used. The process boundary is the security boundary; the
static source checks are a quality gate, not a boundary. Not covered: a vulnerability in Node itself, and side channels such as timing.

## Time, randomness and replay
A run happens before the action (`ToolDef.external`) and its result is journaled with the command, so a replay applies exactly that result and starts no process.
`wait()` is virtual: the engine waits the total in simulation time and applies everything at the end, as timed tools do. A plugin that is interrupted mid-wait
is not resumed after a restart (unchanged from before). Results carry the life generation, so a result for a life that has ended is refused.

## Install, pins and grants
Install is a recorded controller command. It pins the SHA-256 of the exact source and the capabilities that source declares. A later change to the file
disables the plugin until it is installed again; the new source gets only the capabilities it declares. Built-in plugins ship with the release and are
pinned at each start. Existing grants (`tools.approved`) are not changed by this: granting a tool never grants a capability it did not declare.
Plugins from the old tool smith, whose file is missing or was never installed through review, stay disabled with the reason shown in `/api/plugins`.

## Writing one
Start from `src/server/plugins/dig.ts`. Validate inputs and `throw new ToolError("…")` for normal failures. Return a vivid second-person string.
The first comment line of a generated plugin is `// TEST_ARGS: {...}`, used by the smoke test, which runs the plugin in the same sandbox against a made-up corner of the island.
