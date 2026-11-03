# River World — Simulation Engine Technical Specification

Version: 1.0 • Date: November 3, 2026 • Status: proposed, not implemented

Source baseline: `mriver15/river` commit `d320b695446ea98e356216013afca2b34f33a130`, the supplied River World specification, and the preceding architecture review. This document specifies the complete improvement program discussed in that review. It preserves existing product features while moving them onto a coherent simulation foundation. It does not claim that proposed acceptance criteria have already passed.

## 1. Product outcome and constraints

River should live in a persistent world whose consequences continue coherently between model calls. An authoritative engine advances the world; an LLM chooses intentions and interprets experience; a 3D client displays committed state.

The intended result is a world that can pause, resume, accelerate, replay, and survive restarts without changing its rules. Objects remain the same objects when carried or dropped. Feelings arise from perceived causes and personal history. Routine activity executes without repeated inference.

### 1.1 Product invariants

1. **Stimuli, never assigned goals.** The engine describes consequences and executes River's chosen activities. It does not invent ambitions, optimize an undisclosed reward, or show the human catalog to River.
2. **Blank start.** A new life begins with permitted bodily capabilities, without inherited beliefs, learned procedures, or personal attachments. The island and its physical history may persist.
3. **Human authority.** Grants, gifts, configuration, time controls, and resets are explicit commands. Controller knowledge is separate from River's knowledge.
4. **Persistent consequences.** Fire, injury, resource consumption, construction, and death survive restart and replay.
5. **Token mindfulness.** Routine physical behavior is deterministic. Model calls occur at decision boundaries and for meaningful expression.
6. **Local operation.** The engine runs without a model service, embedding service, renderer, or internet connection.
7. **Honest functionality.** Text describing an object or an action cannot create a mechanical capability that its definition does not support.

### 1.2 Scope

Included: engine extraction; unified time; deterministic random behavior; commands and events; snapshots and replay; persistent procedures; reflexes; event-driven deliberation; memory/context optimization; persistent item identity; materials and crafting; procedural 3D objects; emotional appraisal; relationships and beliefs; versioned parameters; inspection and diagnostics; fast-forward; offline progression; plugin boundaries; migration of all existing simulation features.

Deferred beyond this program: multiplayer, a second LLM inhabitant, general rigid-body simulation, arbitrary generated executable geometry, an unrestricted crafting chemistry system, seasons/ecological population expansion, and new narrative packs. Existing optional story, music, wildlife, and tool features remain supported. Deferring new content does not permit dropping existing behavior.

### 1.3 Terminology

| Term | Definition |
|---|---|
| World | Persistent island and physical objects |
| Timeline | A sequence of committed simulation ticks and external inputs |
| Life | One incarnation of River within a timeline |
| Tick | One fixed simulation transition; authoritative ordering unit |
| Activity | A bounded, persistable procedure executing an accepted intention |
| Event | Structured committed outcome, independent of display prose |
| Observation | Information River actually perceived, with provenance |
| Decision packet | A bounded model input assembled from observations and personal state |
| Ruleset | Versioned mechanics and tuning definitions |
| Projection | Derived client, journal, inventory, or search representation |

## 2. Baseline findings and required changes

| Baseline | Current implementation | Required replacement |
|---|---|---|
| Fragmented timers | `index.ts`, `body.ts`, `emotions.ts`, `fire.ts`, `ambient.ts`, and other systems own intervals | One clock and ordered engine step |
| Mixed time semantics | Daylight derives from wall time; many deadlines use `Date.now()` | Simulation deadlines and explicit wall-time operational timers |
| Non-replayable runtime behavior | `Math.random()` throughout world interactions | Seeded, persisted random streams |
| Asynchronous appraisal | Event handlers await embeddings before changing emotion | Deterministic appraisal or recorded external semantic inputs |
| Direct mutation by tools | `ToolDef.run(args, World)` accesses mutable world | Validated commands and restricted query interfaces |
| Item identity discontinuity | Pickup removes entity; inventory and drop create other IDs | One physical identity with a typed location |
| Generic item graphics | Most generic items render as glowing octahedra | Definition-driven visual registry |
| Description-only crafting | Generic `craft` creates name/description without derived mechanics | Validated recipes and bounded assemblies |
| Cycle-driven brain | Repeated context and tool calls; budget pauses brain only | Persistent activities and event-driven decision scheduling |
| Wall-time journal grouping | Past days inferred from epoch and current day length | Immutable simulation timestamps and calendar day indices |

Source links: [world](https://github.com/mriver15/river/blob/d320b695446ea98e356216013afca2b34f33a130/src/server/world.ts), [agent](https://github.com/mriver15/river/blob/d320b695446ea98e356216013afca2b34f33a130/src/server/agent.ts), [tools](https://github.com/mriver15/river/blob/d320b695446ea98e356216013afca2b34f33a130/src/server/tools.ts), [emotions](https://github.com/mriver15/river/blob/d320b695446ea98e356216013afca2b34f33a130/src/server/emotions.ts), [renderer](https://github.com/mriver15/river/blob/d320b695446ea98e356216013afca2b34f33a130/src/client/scene.ts), [journal](https://github.com/mriver15/river/blob/d320b695446ea98e356216013afca2b34f33a130/src/server/journal.ts).

## 3. Architecture and authority

### 3.1 Modules

| Proposed location | Responsibility |
|---|---|
| `src/sim/engine.ts` | Single writer, step order, commits |
| `src/sim/clock.ts` | Tick, simulation elapsed time, speed, pause |
| `src/sim/scheduler.ts` | Ordered, persisted simulation deadlines |
| `src/sim/random.ts` | Versioned random streams and serialization |
| `src/sim/commands/` | Runtime validation, authorization, preconditions, handlers |
| `src/sim/systems/` | Movement, physiology, weather, fire, growth, wildlife, affect |
| `src/sim/activities/` | Procedure definitions and serializable execution |
| `src/sim/perception/` | Visibility, hearing, observation creation, known-world view |
| `src/sim/items/` | Instances, materials, recipes, transfers, equipment |
| `src/sim/persistence/` | Snapshot codec, migrations, hashes, event commits |
| `src/brain/` | Decision scheduler, context builder, model adapter, reflections |
| `src/content/` | Versioned item definitions, visual recipes, parameters |
| `src/shared/protocol/` | Versioned transport DTOs and schema definitions |
| `src/client/renderers/` | Visual registry, equipment, condition effects |
| `src/client/debug/` | Timeline, causes, activity and token inspectors |
| `src/server/` | HTTP, WebSocket, authentication, persistence adapters, service startup |

Module boundaries come first. Initially run the engine in the existing Node process. Later isolate it in a worker with typed messages; a separate service is optional, not a prerequisite. Continue using TypeScript, SQLite, and Three.js. No new ECS or physics dependency is required for the MVPs.

### 3.2 Authority rules

- Only the engine commits authoritative simulation state.
- Model, human, plugins, and background services submit inputs; they cannot write physical state directly.
- All state-changing commands have runtime validation, capability checks, idempotency, lifecycle checks, and preconditions.
- The renderer receives projections and interpolates visuals; browser frame rate cannot influence outcomes.
- Embeddings, generated text, and tool-forging results are external data with recorded provenance.
- Read-only queries cannot consume authoritative random numbers or mutate state.
- Simulation code may not import network clients, UI modules, system time, or unrestricted database handles.

### 3.3 Engine contract

Illustrative TypeScript contracts; implementation must supply runtime schemas as well as static types.

```ts
interface Engine {
  enqueue(command: CommandEnvelope): CommandReceipt;
  step(ticks: number): CommitBatch[];
  query(query: AuthorizedQuery): QueryResult;
  snapshot(): SimulationSnapshot;
  restore(snapshot: SimulationSnapshot): void;
}

interface CommandEnvelope {
  commandId: string;             // idempotency key within timeline
  timelineId: string;
  lifeId?: string;
  actorId: string;
  source: "human" | "brain" | "activity" | "plugin";
  expectedRevision?: number;
  observedAtTick?: number;
  issuedAtTick: number;          // assigned by ingress
  executeAtTick: number;         // assigned/validated by engine
  expiresAtTick?: number;
  sequence: number;              // engine-assigned total order
  type: string;
  payload: unknown;
}

interface SimEvent {
  eventId: string;
  timelineId: string;
  lifeId?: string;
  tick: number;
  sequence: number;
  type: string;
  subjects: string[];
  causeEventId?: string;
  commandId?: string;
  rulesetVersion: string;
  payload: unknown;
}
```

The server derives actor identity and source from the authenticated ingress; a browser or model cannot self-assert authority in its payload. Single-user deployment still needs server-side controller authorization for administrative commands. Existing tool grant semantics remain enforced.

## 4. Unified clock and calendar

### 4.1 Canonical units

Use integer ticks with an initial fixed step of **100 simulation milliseconds**. Use a canonical day of **1,440,000 simulation milliseconds**, preserving the current default 24-minute pacing at 1×. This is a game-time unit, not an assertion that one astronomical day lasts 24 minutes.

- At 1×, one real second advances one simulation second.
- Displayed clock time maps one canonical day to 24 displayed hours.
- A requested day length of N real minutes sets speed to `24 / N`.
- Existing durations expressed in real milliseconds migrate to simulation milliseconds at the baseline rate.
- Rates are documented per simulation second; UI may additionally show an equivalent per displayed day.

This choice preserves baseline mechanics. Changing day length now accelerates all physical systems together; that is an intentional behavior change from the old daylight-only control. A future change to canonical day length requires a versioned calendar migration, not a live reinterpretation.

```ts
interface SimulationClock {
  timelineId: string;
  tick: number;                  // nonnegative safe integer
  stepMs: 100;
  calendarOriginMs: number;      // initial offset, e.g. 30% into day 1
  dayDurationMs: 1440000;
  speed: number;
  paused: boolean;
}
```

Simulation elapsed time is `tick * stepMs`; calendar time adds the fixed origin offset. Validate safe-integer limits. Do not recalculate old event dates when speed changes.

### 4.2 Time controls

| Control | Required behavior |
|---|---|
| Pause world | Freeze all authoritative systems, activities, and deadlines |
| Pause thinking | Stop initiating model requests; existing activities and reflexes continue |
| Change speed | Adjust wall-to-simulation accumulation; preserve current tick and calendar |
| Advance to dawn | Execute engine transitions until the next dawn or a stop condition |
| Resume after restart | Resume at last committed tick; default offline policy is frozen |
| New life | Change life identity, cancel its work, retain world time and world history |
| New world | Start new world/timeline and seed; keep authorized user settings |
| Replay | Read-only playback of recorded history; no live model or write side effects |

Use a monotonic host timer for accumulation. Accumulate lag instead of discarding it. Process a bounded number of ticks per host turn, then yield so controls remain responsive. If backlog exceeds limits, show degraded speed; never silently skip simulation time.

Administrative pause/resume commands are handled at a quiescent engine boundary even while simulation ticks are frozen. Pausing during an in-flight request does not permit its eventual response to mutate paused state; queue and revalidate on resume or cancel it.

### 4.3 Scheduler

Persist jobs as `(dueTick, phasePriority, insertionSequence, jobId, type, payload)`. Quantize durations upward to ticks. Cancellation is explicit. Replace `setTimeout` for sleep, movement deadlines, moment aggregation, weather changes, growth, and cooldowns. Operational API timeouts and UI animation remain on wall/presentation time.

## 5. Deterministic transitions, transactions, and replay

### 5.1 Fixed phase order

Each tick uses this stable order:

1. Admit eligible external commands in sequence order and validate preconditions.
2. Apply scheduled environmental transitions, such as weather and daylight boundaries.
3. Advance activity intentions, movement, and wildlife movement.
4. Resolve spatial interactions, fire exposure, attacks, gathering, and construction work.
5. Apply physiology, resources, growth, wear, and injury progression.
6. Resolve terminal conditions, including death, and cancel invalid work.
7. Generate observations from sensed outcomes and update deterministic affect/relationships.
8. Evaluate completion/interruptions and enqueue brain decision triggers.
9. Check invariants, commit state/events, and publish projections.

Same-tick conflict rules are versioned: a target destroyed before an interaction resolves causes that interaction to fail; death cancels remaining actor effects; simultaneous resource claims resolve by command/activity sequence. Newly emitted cross-phase work cannot recurse indefinitely in the same tick. Each event type declares the earliest eligible phase or next tick.

### 5.2 Randomness

Use a specified PRNG algorithm and version. Derive independent streams from world seed plus stable stream keys such as `weather`, `fire:<entityId>`, and `wildlife:<entityId>`. Persist each stream's state. Cosmetic randomness uses a different client namespace and never feeds back into simulation.

All iteration affecting outcomes uses stable sorted IDs or explicit sequence numbers. Core code must not use `Math.random()`. Tests/lint rules enforce the boundary. Record the initial world seed even when chosen nondeterministically by the controller.

### 5.3 Persistence model

Add tables, using versioned migrations rather than silently swallowed schema errors:

| Table | Key and content |
|---|---|
| `sim_timelines` | Timeline ID, parent/fork point if any, world ID, seed, engine/rules/content versions |
| `sim_snapshots` | Timeline + tick, codec version, complete state blob, canonical hash, last input/event sequence |
| `sim_commands` | Timeline + command ID unique; ordered input, status, result |
| `sim_events` | Timeline + event sequence unique; tick, type, subjects, cause, payload |
| `sim_external_results` | Request ID, lifecycle, response content/hash, semantic results, admitted tick |
| `sim_activities` | Durable activity instances or materialized snapshot projection |
| `sim_observations` | Observer, source event, tick, modalities, confidence, observed facts |
| `sim_rulesets` | Immutable version and content hash, parameter document |
| `sim_migrations` | Applied migration IDs and migration reports |

Existing entity, inventory, memories, and UI tables can remain projections during migration. Exactly one authority exists for each migrated field. Do not allow old tables and engine snapshots to independently own the same data.

Use a transaction for accepted inputs, committed outcomes, changed durable projections, and commit cursor. Publish WebSocket messages only after commit. On database failure, publish nothing, restore the pre-tick working state or stop the engine, and retry without duplicating side effects. Periodic snapshots accelerate recovery; durable ordered inputs and engine versions permit deterministic reconstruction between snapshots. Persist commands before acknowledging durable acceptance.

### 5.4 Replay contract

Restore a snapshot and rerun admitted commands/external results through the pinned ruleset. Recomputed events are verification output; do not also apply recorded events as mutations. Journal prose and semantic scores are replayed as recorded external results; never regenerate them during replay.

Canonical hashing sorts object keys, entity IDs, and map entries; excludes wall timestamps, network status, caches, and renderer state; rejects NaN/Infinity. MVP guarantees exact replay on the pinned Node/runtime and engine version. Cross-runtime or cross-platform bitwise guarantees require fixed-point/quantized math and separate certification.

Snapshots must contain clock, RNG, pending jobs, activities, physical state, affect, relationships, observation cursors, and rule/content version references. Durable external response records prevent dependence on live embeddings or model services.

## 6. Command validation and asynchronous boundaries

Every command returns accepted, rejected, or duplicate, with a stable reason code such as `STALE_LIFE`, `TARGET_GONE`, `OUT_OF_REACH`, `CAPABILITY_DENIED`, `RESOURCE_SHORTFALL`, `INVALID_DESIGN`, or `EXPIRED_DECISION`. Human-readable prose is derived from the result.

Revalidate target existence, ownership, reach, permissions, and capacity at execution. A version mismatch may be safe for a read-only query but requires revalidation for a physical action. Never reject every old decision blindly when its preconditions remain true; record the validation outcome.

Each brain request carries a lifecycle generation, observation tick, request ID, and activity revision. Cancellation attempts use the model adapter's abort mechanism, but correctness comes from rejecting late results belonging to old generations. Apply the same fence to reflection, dreams, generated stories, embeddings, and forged plugins.

Human commands arriving together are ordered by server receipt sequence. A browser-supplied timestamp cannot retroactively insert a command. Persist completed command results so retries return the original outcome.

## 7. Activities, reflexes, and navigation

### 7.1 Persistent activity contract

```ts
interface ActivityInstance {
  id: string;
  ownerId: string;
  lifeId: string;
  definitionId: string;
  definitionVersion: string;
  status: "queued" | "running" | "interrupted" | "completed" | "failed" | "cancelled";
  intent: string;
  parameters: unknown;
  stepId: string;
  progress: unknown;
  startedAtTick: number;
  deadlineTick: number;
  reservations: string[];
  interruptPolicyId: string;
  outcome?: unknown;
}
```

Persist data, not JavaScript promises, closures, timers, or iterator stacks. Definitions are versioned finite-state machines. Each transition is bounded and deterministic. Activity instances retain their definition version through upgrades or undergo an explicit migration.

### 7.2 Initial procedures

| Procedure | Preconditions | Completion | Key interruptions |
|---|---|---|---|
| Travel | Known destination; traversable route | Within arrival radius | Threat, blockage, injury, target removed |
| Gather | Known source; granted ability; capacity | Requested quantity or declared depletion limit | Depletion, danger, capacity, deadline |
| Rest | Valid bodily state | Energy threshold or duration | Fire, attack, sound threshold, human contact policy |
| Craft recipe | Known permitted recipe; ingredients/tools | Validated output created | Lost materials, danger, workspace loss |
| Build | Granted tool; valid site/design; materials | Required work and components complete | Danger, support invalidation, missing materials |
| Tend fire | Known accessible fire; fuel/water permissions | Requested duration or target condition | Fire spreading, depleted supply, danger |
| Perform music | Composition available; required instrument | Score duration elapsed | Danger, inability to perform, cancellation |

Actions have explicit durations. Reserve materials when appropriate; consume at declared transition points. Cancellation releases unconsumed reservations but does not recreate already burned fuel or consumed ingredients. Return structured partial progress.

### 7.3 Navigation

Use a deterministic grid or navigation graph built from existing terrain and obstacle footprints. A* tie-breaking uses stable cell IDs. Replan only on relevant obstacle changes or failed progress. Terrain/world collision queries are authoritative; the known-world planner must not reveal hidden items or goals. Walking may encounter an unknown obstruction and produce a discovery.

MVP uses 2.5D grounded movement with explicit surface elevation. Bridges expose walkable surfaces. Towers/platforms gain explicit vertical access only when represented by navigation links; visual height alone must not imply climbability.

### 7.4 Reflexes and learned routines

Reflexes are limited bodily policies: stop before known impassable terrain, recoil from immediate heat, wake from injury, and a configurable short escape response to perceived imminent danger. They may preempt activities but cannot invent goals, reveal hidden threats, or use ungranted skills. Emit an outcome that River can later interpret.

Learned routines require an explicit successful history or River's accepted intention. Cache procedure structure, not model prose as executable code. The blank-life reset clears learned routines. A minimum viable activity library is an execution mechanism, not an omniscient survival planner.

## 8. Event-driven cognition and token management

### 8.1 Decision scheduler

Decision triggers: human contact; failed/completed activity; newly perceived danger; significant plan invalidation; major emotional change; idle with no intention; and periodic deliberation deadline. Each trigger has priority, expiry, coalescing key, and minimum spacing.

Default priorities: immediate perceived threat/critical interruption; human contact; activity failure; completion; significant novelty; periodic thought. Reflexes act without waiting for inference. Coalesce compatible pending triggers into one packet. Avoid concurrent physical-decision requests for one life.

Use hysteresis for threshold triggers: enter and exit thresholds differ. A persistent low-need state must not trigger a model call every tick. Retry failures with wall-time backoff and recorded admission ticks; repeated provider failures cannot freeze the engine.

### 8.2 Decision packet

Include: stable identity/system prefix; simulation timestamp; relevant bodily/affective state; current intention and activity progress; recent unacknowledged observations; relevant known objects; bounded memory retrieval; known capabilities; and a typed requested response shape.

Suggested initial input allocation, tunable after measurement: 25% stable identity/capabilities, 20% current state and activity, 25% observations, 20% memories, 10% reserve. Actual token counts use adapter tokenization where available and conservative estimates otherwise. Never truncate away a critical constraint merely to meet a section allocation.

Delta packets require a compact baseline. If the provider has no durable conversation state, omitted facts are unavailable. Cache stable prefixes opportunistically; correctness must not depend on cache hits.

### 8.3 Memory and reflection

- Store factual episodes linked to source event IDs, simulation time, life, place, and subject IDs.
- Keep beliefs and interpretations separate from physical facts.
- Summarize repetitive activity outcomes deterministically before considering an LLM summary.
- Retrieve by relevant subjects, active intentions, location, salience, and recency; embeddings supplement these signals.
- Pin embedding model/version and record any scores that influence authoritative state.
- Replace every-N-cycles reflection with experience thresholds plus a maximum interval.
- Journals consume immutable day-indexed events. Record narrative output; generated prose never creates physical events.
- Dreams may propose interpretations or intents, but cannot grant facts about unseen events.
- Memory reset on new life must not erase world provenance or previous-life archives from the human view.

### 8.4 Budget and degraded operation

Maintain wall-time token/spend windows separately from simulation time. Budget all model consumers: decisions, reflections, dreams, stories, and forging. Reserve an initial configurable 20% for high-priority decisions/human contact; this is a tuning default, not a guaranteed cost reduction.

At exhaustion, existing activities and reflexes continue. Do not set a sleeping state just because billing budget is empty. Expose two explicit policies: continue world with procedural behavior, or pause world at the next unresolved decision boundary. Default interactive mode uses the latter for unresolved decisions; unattended mode may use the former. No invisible invulnerability is introduced.

Track input/output/reasoning tokens when supplied, cache use, wall latency, decision reason, activity ID, tokens per simulated day, and completed intentions per 1,000 tokens. Proposed release target: at least 50% fewer tokens per matched simulated-day scenario than the measured baseline, with no increase in missed critical interruptions. This target is unmeasured until benchmarked; compare multiple matched seeds and equivalent decisions/workloads.

## 9. Physical item model and mechanics

### 9.1 Identity and location

```ts
type ItemLocation =
  | { kind: "world"; position: { x: number; y: number; z: number }; surfaceId?: string }
  | { kind: "inventory"; ownerId: string }
  | { kind: "equipped"; ownerId: string; slot: string }
  | { kind: "container"; containerId: string }
  | { kind: "consumed"; eventId: string };

interface ItemInstance {
  id: string;
  definitionId: string;
  definitionVersion: string;
  location: ItemLocation;
  quantity: number;
  condition: { durability: number; wetness: number; temperatureC: number };
  materialParts: MaterialPart[];
  provenance: { createdAtTick: number; makerLifeId?: string; sourceIds: string[] };
  visual: { recipeId: string; version: string; seed: number; parameters: unknown };
}
```

Names and inscriptions are metadata. Pickup/drop/equip/container transfer preserves ID and all condition/provenance. Exactly one location exists per live item. Prevent container cycles, over-capacity moves, negative quantities, and concurrent double ownership.

Unique objects never stack. Fungible items stack only when definition, material, condition bucket, and provenance policy permit it. Splits create child IDs with lineage; merges retain lineage and record consumed IDs. Sentimental or inscribed objects are automatically nonfungible. During migration, unknown historical provenance is marked unknown, not invented.

### 9.2 Materials and affordances

Definitions contain explicit dimensions, mass, material composition, capabilities, thermal/fuel properties, durability, interaction slots, and visual recipe. Units: metres, kilograms, Celsius, simulation seconds, normalized condition values. Parameters only become active when a mechanic uses them.

Initial material set: wood, stone, bark, moss, hide, clay, charcoal, and pigment. Existing items with unsupported materials use a conservative inert definition until added. Capabilities such as cuts, binds, holds-liquid, burns, insulates, or marks are derived through versioned rules. An LLM-authored description cannot add a capability.

### 9.3 Crafting and construction

Recipe definitions declare inputs, quantities, tools/capabilities, work location, duration, output definition, byproducts, and failure rules. Validate the full input set before consuming anything. Deterministic quality derives from material condition, permitted skill history, tools, and explicit seeded variation.

Bounded assembly supports component roles, such as shaft + head + binding. Validate compatibility, dimensions, mass budget, and connection count. Unsupported inventive designs become proposed experiments or decorative objects with honest limitations; they do not silently acquire claimed powers.

Structures use the same material/provenance principles plus footprint, support, shelter, flammability, and navigation components. Persist partially completed construction. Dismantling uses declared recovery rules tied to actual remaining material, rather than recreating already destroyed parts.

## 10. 3D representation and feedback

### 10.1 Visual registry

Map `(recipeId, version)` to deterministic mesh builders or approved asset references. MVP uses existing Three.js primitives and shared procedural helpers. Build first-class recipes for stick, stone, spear, bowl, bottle, book, food, pigment, garment, instrument, and generic bounded assembly.

Every definition provides dimensions, pivot, orientation, attachment sockets, collision footprint, material channels, and LOD policy. Server collision derives from definition geometry bounds, not the loaded client mesh. Mesh assets cannot affect physical truth.

A constrained design document may choose approved component shapes, relative transforms, material IDs, and bounded dimensions. Reject excessive component counts, invalid scales, arbitrary URLs, and executable geometry. Initial limit: 32 components per custom item, configurable after profiling.

### 10.2 Required rendering behaviors

- Same object appears consistently on ground, in inventory preview, and equipped.
- Hand/body sockets position held items and garments.
- Wetness changes roughness/darkness; burning adds char/flame states; damage and repair expose component changes.
- Stable seeds prevent appearance changing after pickup or restart.
- Unknown recipe versions render a dimension-correct neutral fallback with a diagnostic, not a misleading functional model.
- Reuse geometry/materials and instance repeated resources. Dispose orphaned resources.
- Separate 3D effects from authoritative state; interpolate only between committed positions.
- Expressions/posture expose bounded affect channels such as tension, gaze, gait, and slump. These are visual signals, not new simulation causes.

MVP 3D representation does not require rigid-body dropping or mesh-level collision. Add physical dynamics only if a concrete interaction requires it and determinism is preserved.

## 11. Perception, emotions, relationships, and beliefs

### 11.1 Perception boundary

World events are not automatically observations. Visibility requires range, lighting/weather, and occlusion where supported. Hearing uses distance and event loudness. Contact and bodily signals have direct channels. Store observed facts, modality, confidence, source event, and observed tick.

River's context and activity target selection use known-world data. The human inspector can show full state. A distant animal death cannot create grief until River learns about it; discovery may occur later through remains, absence with uncertainty, or human speech.

### 11.2 Affective layers

| Layer | Fields | Update basis |
|---|---|---|
| Physiology | Hunger, fatigue, cold, pain, illness | Body systems |
| Affect | Valence, arousal, perceived control | Perceived events and sustained conditions |
| Emotion | Existing wonder/restlessness/longing/loneliness/frustration/playfulness/pride/fear/grief | Appraisal and decay |
| Disposition | Learned caution, confidence, attachment tendencies | Slow, bounded updates from experience |

Keep current internal emotion IDs (`boredom`, `dread`) mapped explicitly to user-facing restlessness/fear; avoid accidental schema breaks. Do not add dozens of labels before the causal model is stable.

### 11.3 Deterministic appraisal

Appraisal inputs: novelty, relevance to an accepted intention, attachment, expectation error, controllability, perceived responsibility, physiological vulnerability, and habituation. Use typed events and stable subject IDs. MVP computes relevance from explicit subject/tag/goal links. Optional embedding relevance is a recorded external annotation; live completion order cannot change prior ticks.

For each emotion, decay by `level *= 2 ** (-deltaSimSeconds / halfLifeSeconds)` and apply bounded appraisal/sustained-condition inputs in the defined phase order. No negative or nonfinite levels. Sustained loneliness and pain require continuous inputs; decay alone does not erase their causes. Habituation keys include event class and relevant subject/context, preventing all animals or all discoveries becoming equivalent.

Each update records an explanation with cause event, prior value, factors, delta, and resulting value. Suppress low-value trace volume through deterministic aggregation, while retaining full traces in test/debug mode.

### 11.4 Relationships and attachment

Store links from a life to subjects: familiarity, trust, affection/attachment, fear association, last encounter, and evidence events. Links may target creatures, items, places, or human contact identity. Current creature trust remains distinct from River's own attachment to that creature.

Attachment grows from actual creation, repeated use, naming, care, and shared experiences; it is not automatically maximal for every named object. Loss severity depends on that link. Repair, rediscovery, betrayal, and successful care can create mixed feelings.

### 11.5 Belief ledger and emotional behavior

Represent claims with proposition, subject IDs, confidence, supporting/contradicting observation IDs, and last revision. Separate measured facts from hypotheses. MVP supports recording and revising claims through explicit observations; no unrestricted symbolic inference engine is required.

Emotions influence attention weights, memory salience, posture, and bounded interruption tolerances. They must not grant hidden information or forcibly replace River's intention with a designer's goal. Sampling temperature remains optional and bounded. Critical safety thresholds cannot be disabled merely by low fear.

## 12. Parameters, inspection, and protocol

### 12.1 Parameter registry

Each parameter defines key, type, unit, default, minimum/maximum, dependencies, owning system, ruleset version, and application mode (`immediate`, `new-instance`, `restart/migration`). Changes enter as recorded commands. Snapshots reference immutable parameter sets.

Initial groups: clock; survival; wildlife; fire/growth; activity duration/retries; emotion half-lives/appraisal weights; perception; deliberation/budget; visual budgets. Rename ambiguous settings: hunger uses fullness or explicit drain semantics; thought interval indicates simulation-time deliberation deadline rather than guaranteed API cadence.

For random continuous hazards, use `p = 1 - exp(-lambda * dt)` with documented units. Stable fixed stepping is still required for exact stochastic replay; this formula alone does not make arbitrary stepping equivalent.

### 12.2 Human inspection

Add a Simulation panel showing tick/day, speed, world/brain pause state, active activity and progress, interruption cause, pending decisions, engine lag, and current ruleset. Add an entity inspector showing identity, location, material/condition, provenance, visual definition, and supported affordances.

Emotion inspection shows causes and relationships. Timeline inspection filters events by actor, object, activity, and causal chain. Token inspection separates model consumers and reasons. Explanations use committed structured records; an LLM is not needed to tell the user why warmth fell.

### 12.3 Protocol changes

Add schema version and timeline/revision metadata to initialization. Incremental updates carry tick, sequence, and base revision. On sequence gap or incompatible version, request a full snapshot. Reconnection cannot duplicate commands. Keep the existing UI message adapter during rollout.

Proposed client commands: `sim.pause`, `brain.pause`, `sim.set_speed`, `sim.advance_until`, `activity.cancel`, `rules.update`, `timeline.replay`, and `entity.inspect`. Controller commands require controller authorization. Client previews are projections; never accept a client-provided physical state snapshot as authoritative.

## 13. Fast-forward, offline operation, and branches

### 13.1 Fast-forward MVP

Initially execute the same fixed ticks without rendering every tick. Batch projection delivery and yield periodically. This produces speedup without introducing a second physics implementation. Stop on dawn target, death, human cancellation, unresolved critical decision, or configured work budget.

If an LLM decision is needed, pause at the boundary in interactive fast-forward mode. Optionally request a new decision within budget, then resume. Never execute a future command before its admission tick.

### 13.2 Optimized advancement

Only analytically advance a system across an interval if no relevant inputs/interactions occur and equivalence is tested. Jump to the earliest of scheduled event, threshold crossing, activity completion, or perception-changing interaction. Active fire, movement near hazards, combat, and coupled physiology use fixed steps unless an equivalent solver is demonstrated.

### 13.3 Offline policy

Default: freeze at last commit. Optional catch-up: calculate bounded wall-time absence, convert via recorded speed policy, then advance through the same engine. Display a catch-up summary and decisions encountered. Initial maximum catch-up is one world day, configurable. Additional elapsed wall time is explicitly deferred, not silently simulated or discarded.

### 13.4 Replay and branching

Read-only replay is required; branching is a later MVP extension. A branch receives a new timeline ID, parent timeline/tick, snapshot, and copied version references. No original history is rewritten. Model decisions on a branch are new external inputs. Prior-life archives remain human-visible; River does not inherit them unless a future explicitly authorized feature changes the blank-start rule.

## 14. Plugin and tool-smith integration

Change plugin execution from mutable `World` access to a restricted capability context with read-only perceived queries and command proposals. Generated plugins cannot write SQLite, create timers, call random/system time, or directly mutate engine objects.

Prefer declarative recipes, visual assemblies, and procedure definitions for common requests. Generated executable plugins require isolated execution with bounded CPU/memory and schema-validated outputs. Static text checks and smoke tests remain useful quality gates but are not a security boundary. Worker threads alone are not a security sandbox; use a process/runtime isolation boundary appropriate to the deployment.

Install is a recorded controller command pinning plugin version/hash and declared capabilities. Preserve the staged human review flow. Existing grandfathered grants migrate explicitly; granting one tool does not grant arbitrary new capabilities. Unsupported legacy plugins stay disabled with a migration explanation until adapted.

## 15. MVP delivery plan

All MVPs below are proposed. Each is an independently reviewable increment with a working demonstration and explicit exit criteria. Phases are ordered by dependency, not calendar estimates.

### MVP 0 — Baseline and migration preparation

**Goal:** establish a reproducible comparison and protect current worlds.

**Scope:** inventory every authoritative timer/random call; document ownership of state fields; capture representative isolated fixture databases; measure baseline token use and scenario outcomes; add schema migration framework and backup/restore command.

**Deliverables:** clock/random audit, fixture generator, baseline report, schema version table, migration checklist.

**Acceptance:** fixtures never point to production `data/`; current build/typecheck passes or pre-existing failures are documented; database backup restores; fixtures cover new life, injury, fire, crafting, animals, and grants. Baseline measurements distinguish mock execution from live-model cost.

**Excludes:** behavior redesign and production database conversion.

**Depends on:** none.

### MVP 1 — Headless engine and coherent time

**Goal:** all physical systems advance through one clock.

**Scope:** engine module; fixed stepping; simulation clock/calendar; system phase order; scheduler; world/brain pause separation; migrate needs, body, fire, weather, growth, wildlife, creatures, emotions, story timing, music duration, and sleep deadlines. Introduce typed command adapters for existing tools.

**Deliverables:** headless runner, clock controls, compatibility adapter, basic causal events, timer-free simulation systems.

**Acceptance:** world pause freezes all authoritative fields for 60 wall seconds; 1× and accelerated runs with identical admitted commands produce equivalent state; speed changes do not move historical events between days; no world subsystem starts an interval; next dawn advances injuries/growth/weather as well as lighting.

**Excludes:** exact replay certification, token optimization, new object visuals.

**Depends on:** MVP 0.

### MVP 2 — Deterministic state, durability, and replay

**Goal:** recover and reproduce a life independently of network services.

**Scope:** seeded streams; complete snapshot codec; ordered commands/external results; idempotency; transactional persistence; canonical hashes; lifecycle fencing; read-only replay; initial perception event split.

**Deliverables:** replay CLI, snapshot inspector, crash recovery, deterministic fixtures, command rejection codes.

**Acceptance:** at least 20 fixed seeds replay for three world days with matching checkpoint hashes on the pinned runtime; process termination between commits loses no acknowledged commands; retries cannot duplicate items; stale responses after death/reset produce no mutations; replay makes zero network calls and sends no live notifications.

**Excludes:** arbitrary old-version replay without retained compatible engine/rules assets; offline catch-up optimization.

**Depends on:** MVP 1.

### MVP 3 — Activities, navigation, and reflexes

**Goal:** one intention produces sustained, interruptible action.

**Scope:** persisted finite-state activities; deterministic pathfinding; travel/gather/rest; reservations and cancellation; minimum reflexes; known-world target constraints; partial outcomes. Add known-recipe crafting/building/music activities using current definitions where valid.

**Deliverables:** activity registry, progress UI, interruption policy, restart-safe execution.

**Acceptance:** gather-three-and-return executes without intermediate model calls; restart midway preserves progress; depleted target returns partial completion; fire interrupts rest; cancel releases only unconsumed reservations; new life cancels old work; navigation cannot cross blocked structures or disclose unseen resource targets.

**Excludes:** automatically invented routines and a general goal planner.

**Depends on:** MVP 2.

### MVP 4 — Event-driven brain and memory budget

**Goal:** reduce inference while preserving agency and responsiveness.

**Scope:** prioritized/coalesced triggers; compact state packets; memory relevance; reflection thresholds; model-consumer accounting; emergency reserve; explicit exhausted-budget behavior; async result fencing across all model consumers.

**Deliverables:** decision inspector, token benchmark harness, packet schema, compact summaries, adapter cancellation.

**Acceptance:** repeated stable routine steps produce no new calls; human speech and perceived critical interruption enter the highest relevant priority queue; retries and timeouts preserve world consistency; target 50% lower tokens per matched simulated day is measured against MVP 0; report behavioral tradeoffs and provider variance rather than claiming guaranteed savings.

**Excludes:** replacing routine work with another small model; deterministic procedures are the initial solution.

**Depends on:** MVP 3.

### MVP 5 — Persistent objects and mechanical crafting

**Goal:** objects have stable identity and supported physical meaning.

**Scope:** unified item locations; instance/definition split; materials; condition; provenance; stack rules; equipment/containers; validated recipes; bounded assemblies; structures and partially completed work; conservation checks.

**Deliverables:** item registry, migration adapter, recipe validator, item inspector, initial definitions for existing materials/tools.

**Acceptance:** pickup/drop/equip preserves identity and condition; stack split/merge retains quantities and lineage; invalid recipes consume nothing; valid recipes consume exactly declared inputs; described properties do not grant undeclared capabilities; fire/dismantling cannot duplicate material; container cycles fail.

**Excludes:** unrestricted physics, chemistry, or generative functional inventions.

**Depends on:** MVP 3; integrates with MVP 4 when available.

### MVP 6 — Consistent procedural 3D items

**Goal:** objects look like their definitions across the world and UI.

**Scope:** visual registry; first 12 item families; shared previews; equipment sockets; deterministic assemblies; wet/burned/damaged/repaired appearance; dimensions and collision alignment; LOD/resource reuse; affect-driven posture.

**Deliverables:** visual gallery fixture, item preview component, geometry validation, fallback rendering.

**Acceptance:** same instance has matching visual parameters after transfer/reload; inventory and world previews use the same recipe; supported items no longer fall back to the generic glowing octahedron; invalid designs cannot allocate unbounded meshes; collision bounds agree with documented dimensions; screenshot checks cover each condition and equipment slot.

**Excludes:** arbitrary AI-generated meshes and rigid-body simulation.

**Depends on:** MVP 5.

### MVP 7 — Causal emotions, attachment, and beliefs

**Goal:** personal history explains feelings and their consequences.

**Scope:** typed perception; appraisal factors; simulation-time decay; relationships to creatures/items/places; mixed emotions; expectation/belief ledger; cause traces; memory salience; attention and posture integration.

**Deliverables:** emotion inspector, relationship view, belief records with evidence, deterministic appraisal fixtures.

**Acceptance:** unseen destruction causes no grief until discovered; loss of a valued personal object differs from loss of a generic resource; restored/repaired object updates attachment and affect consistently; habituation recovers over simulation time; duplicate events cannot double-appraise; embedding latency/order does not alter replay; new life clears personal beliefs and attachments.

**Excludes:** claims of psychological realism or human-like consciousness; coefficients are gameplay design parameters.

**Depends on:** MVP 2, MVP 4, MVP 5; posture integration uses MVP 6.

### MVP 8 — Fast-forward, offline progression, and tuning

**Goal:** inspect, accelerate, and compare coherent lives.

**Scope:** render-decoupled advancement; bounded offline catch-up; stop conditions; parameter registry/editor; timeline and cause inspection; scenario sweeps; read-only visual replay; optional branching after replay is stable.

**Deliverables:** advance-until control, catch-up summary, experiment runner, parameter presets, performance dashboard.

**Acceptance:** next dawn and offline catch-up match ordinary stepping for the same inputs; acceleration stops at unresolved decision/death according to policy; cancellation responds between batches; old journals keep their day indices after speed changes; parameter changes are replayable; optimized skipping, if introduced, has an equivalence test per system.

**Excludes:** unbounded catch-up and silent prediction of future model decisions.

**Depends on:** MVP 4 and MVP 7; visual replay uses MVP 6.

### MVP 9 — Extension isolation and release migration

**Goal:** make the complete engine safe to extend and upgrade operationally.

**Scope:** restricted plugin API; declarative extension paths; isolated executable extensions; optional worker extraction; protocol compatibility; complete legacy database conversion; backup/rollback rehearsal; end-to-end regression and soak testing.

**Deliverables:** plugin SDK contract, adapted built-ins/plugins, migration report, recovery runbook, release checklist.

**Acceptance:** plugins cannot directly mutate authoritative state; timed-out/late results are fenced; existing grants survive migration correctly; every original feature is assigned and passes the parity matrix; migration runs against a copy and rollback restores it; no undocumented dual state writers remain; three-day unattended fixture run stays within declared resource limits.

**Excludes:** mandatory microservice deployment or introducing a distributed database.

**Depends on:** MVPs 1–8. The restricted command boundary begins in MVP 1; isolation hardening completes here.

## 16. Feature coverage and existing-system migration

| Existing feature | Target integration | MVPs |
|---|---|---|
| Terrain, walking, paths, scorch | Deterministic terrain + movement/trail systems | 1–3 |
| Needs, body, wounds, infection, venom, first aid | Clocked physiology and validated treatment commands | 1–3 |
| Death, graves, new lives | Terminal phase, lifecycle fences, persistent world provenance | 1–2, 5 |
| Weather, ambient director, Keeper story | Scheduled events with seeded selection and perception gating | 1–2, 7 |
| Wildlife and tameable animals | Clocked behavior, deterministic attacks, distinct trust/attachment | 1–3, 7 |
| Fire, cooking, char, regrowth | Material-driven transitions and scheduled ecology | 1–2, 5–6 |
| Building, pigments, clothing | Recipe/activity validation, persistent instances, visual recipes | 3, 5–6 |
| Taste, opinions, self-image, desires | Personal knowledge; recorded accepted interpretations | 4, 7 |
| Music, creature response, resonance | Score duration on sim time; audio as projection | 1, 3, 6–7 |
| Memory, dreams, reflection, journal | Event provenance, sim dates, external outputs fenced and recorded | 2, 4, 7 |
| Catalog, gifts, grants, tool requests | Controller commands; no agent catalog leakage | 1–2, 5, 9 |
| Tool smith and hot reload | Versioned capability proposals and isolated execution | 1, 9 |
| Web search/fetch | External untrusted content; no simulation writes | 2, 4, 9 |
| Controls, UI, WebSocket, settings | Versioned projections, distinct pauses, replay and inspectors | 1, 4, 6, 8–9 |
| Budget, off-peak rules, usage | Wall-time accounting isolated from physical time | 4 |

Off-peak provider pricing schedules are configuration data, not embedded assumptions in simulation rules. Verify/update provider terms separately at implementation time.

### 16.1 Legacy time conversion

At a quiescent migration boundary, capture wall time W, current world day/fraction, and all saved durations/deadlines. Set the new calendar origin so the displayed date is unchanged. For a future deadline D, migrate remaining duration as `max(0, D-W)` simulation milliseconds at baseline compatibility rate; for elapsed ages, preserve `max(0, W-born)` using offsets or migrated timestamps. Quantize to ticks and report rounding.

Historical events do not always have enough information to reconstruct exact simulation dates because old day-length changes reinterpret wall-time history. Preserve original wall timestamps and journal labels; mark inferred dates as approximate with a migration provenance flag. Never fabricate exact historical ticks.

### 16.2 Object conversion

Map each world entity and inventory row to a stable new ID with a legacy-ID mapping. Preserve all known properties. Separate unique items from fungible stacks. Unknown properties remain in a namespaced legacy payload until reviewed. Do not infer that identical old names imply the same historical object.

### 16.3 Rollout sequence

1. Back up the live database using a consistent SQLite backup mechanism and verify restoration.
2. Convert a copy; run invariants and fixture parity checks; generate a migration report.
3. Use a feature flag to choose old or new engine at startup, never both as writers.
4. Optionally run shadow simulation against copied inputs/state for comparison only.
5. Pause ingress, drain/cancel external work with generation fences, take the final backup, convert, and resume.
6. If rollback is needed, restore the backup and old version. Post-cutover new-engine history is retained separately; do not pretend it can be merged backward automatically.

## 17. Validation, performance, and release gates

### 17.1 Required scenario suite

| ID | Scenario | Expected evidence |
|---|---|---|
| T01 | Pause during rain, injury, growth, and travel | No authoritative change while paused |
| T02 | Same recorded decisions at 1×/10× and after restart | Matching canonical checkpoint hashes |
| T03 | Gather, craft, drop, pick up, equip, die | Quantity conservation and stable identity/provenance |
| T04 | Fire during rest and slow/unavailable model | Timely reflex/interrupt; no dependency on API latency |
| T05 | Death/reset while model/reflection/embedding is pending | All stale outputs rejected |
| T06 | Distant named creature dies; remains discovered later | No early grief; later perceived loss appraisal |
| T07 | Budget exhausted during a long activity | Activity continues; unresolved decisions follow selected policy |
| T08 | Duplicate command and crash after commit before broadcast | Exactly one effect; reconnect reconstructs state |
| T09 | Change speed across journal boundaries | Immutable day grouping; no duplicate daily story |
| T10 | Cancel partial construction and dismantle damaged work | Correct reservations and material recovery |
| T11 | Unsupported item design/recipe/plugin | Typed rejection; no partial unauthorized mutations |
| T12 | Advance to dawn/offline catch-up | Same supported outcome as ordinary stepping |
| T13 | Repeated appraisal and habituation recovery | Bounded, deterministic, traceable emotion values |
| T14 | Model context and known-world targeting | No unseen object/catalog/history leakage |

Use injected clocks and RNG, temporary databases, recorded model responses, invariant/property tests, and visual fixtures. Live-model evaluation is separate and reports stochastic behavior rather than exact replay claims.

### 17.2 Initial performance budgets

These are proposed engineering targets, not measured baseline results. Benchmark on a declared reference machine/runtime with a fixed seed and workload.

- Fixture scale: current island, 1,000 physical entities, 100 wildlife entities, one River, and bounded active fires.
- At 1×: p95 simulation step under 10 ms; no sustained backlog.
- Critical local reflex: within two 100-ms ticks after the condition is perceived.
- Human controls: processed between batches, target under 250 ms excluding network transit.
- Fast-forward: target at least 10× on the fixture, with identical outcomes; report achieved speed if lower.
- Client: target 60 FPS on declared desktop hardware; use 30 FPS fallback/LOD without changing simulation.
- Snapshot size, event growth, and memory usage are measured per simulated day; introduce retention/compaction only after preserving required replay inputs and snapshots.

Do not prune records needed to reproduce retained timelines. Archive a consistent checkpoint plus subsequent required inputs before removing old detail. Human log retention and deterministic replay retention are separate policies.

### 17.3 Completion checklist

- [ ] Every authoritative timer uses simulation time.
- [ ] All random outcomes use persisted streams.
- [ ] Tools/plugins cannot bypass command validation.
- [ ] Snapshots include all pending work and version references.
- [ ] Late external results cannot cross lifecycle boundaries.
- [ ] Every physical object has one location and stable identity.
- [ ] Visuals and mechanics use the same item definitions.
- [ ] River receives observations rather than global world events.
- [ ] Token savings are measured with behavior and latency metrics.
- [ ] Every MVP acceptance criterion has evidence or a documented blocking failure.
- [ ] Original feature parity matrix is complete.
- [ ] Migration, backup restoration, reconnect, and restart tests pass.
- [ ] Build/typecheck and appropriate simulation/visual checks pass.

## 18. Recommended first implementation slice

Implement MVP 0, then a narrow MVP 1 slice containing clock, stepping, movement, hunger, rest, and one growing plant. Prove pause and speed consistency. Expand the same contracts to fire, injury, wildlife, and emotions before introducing alternative schedulers or richer content.

The first integrated demonstration should be: River travels to a known tree, gathers three sticks, returns, rests, encounters rain and fire, is interrupted, and resumes correctly after restart. Record the decisions once, replay without a model, and compare hashes. This slice establishes the foundation needed for every later feature in this specification.
