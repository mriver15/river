# River World: product and technical specification

An always-live AI agent, **River**, lives its own life on a persistent, explorable 3D island. A human watches, talks to it, and acts as the world's controller. This document describes everything the system does today. For history and ideas not yet built, see `ROADMAP.md`. For setup and usage, see `README.md`.

Status markers: **[built]** works and was exercised; **[untested live]** works against the mock brain or in simulation but has not been observed with a live DeepSeek River.

---

## 1. Principles

1. **Stimuli, never instructions.** The world may surprise, remember and respond to River, but it never hands River goals, hints, menus or rewards. Sensations are reported as sensations ("your jaw is clenched"), never as advice.
2. **Blank start.** River begins with a body and a mind and nothing else: no tools beyond the basics, no clothes, no structures, no instrument, no colours, no opinions. Anything beyond that must be wanted, asked for (`request_tool`), and granted by the human.
3. **The human is the world controller.** The human grants or denies tools, gifts items, places catalog objects, changes settings, skips time and begins new lives. River is never shown the catalog of what could be granted.
4. **Consequences are real and persistent.** Fire permanently scorches; wounds bleed and fester; death is final for that life. Everything is saved to SQLite.
5. **Token mindfulness.** Anything that costs model tokens is rare (a dream, a daily story, a reflection) or free (sound, trails, local embeddings). The budget stretches during DeepSeek's off-peak hours.
6. **Local first where cheap.** Semantic memory runs on a local embedding model; the brain can be pointed at any OpenAI-compatible server.

---

## 2. Architecture

| Layer | Technology | Location |
|---|---|---|
| Server | Node, TypeScript (run with `tsx`), `ws`, `node:sqlite` | `src/server/` |
| Client | TypeScript, Vite, three.js, WebAudio | `src/client/` |
| Shared | Protocol types, deterministic terrain noise | `src/shared/` |
| Storage | SQLite (WAL) at `data/river.db`; override with `RIVER_DB` | `src/server/db.ts` |
| Brain | DeepSeek, OpenAI-compatible chat API with tool calling; or any compatible server via `LLM_BASE_URL` | `src/server/llm.ts` |
| Embeddings | Ollama `mxbai-embed-large` (default) | `src/server/memory.ts` |

- **One process** serves the built client over HTTP, a WebSocket at `/ws`, and four JSON endpoints (`/api/memories`, `/api/music`, `/api/moments`, `/api/log`).
- **Terrain is deterministic** (`shared/noise.ts`, seed-based) and shared by server and client, so the world is never streamed as geometry; only entities and state are.
- **Hot-reloadable plugins** add tools at runtime (`src/server/plugins/`).
- **Dev/prod:** `npm run dev` (server + Vite), `npm start` (server serving `dist/client`), `npm run build` (typecheck + Vite build).

### Server modules

| Area | Files |
|---|---|
| Agent loop, brain | `agent.ts`, `llm.ts`, `usage.ts`, `config.ts` |
| Memory and mind | `memory.ts`, `mind.ts`, `dreams.ts`, `journal.ts` |
| Tools | `tools.ts`, `toolkit.ts`, `smith.ts`, `plugins/*.ts`, `web.ts` |
| World | `world.ts`, `ambient.ts`, `fire.ts`, `catalog.ts`, `story.ts`, `places.ts` |
| Living things | `creatures.ts`, `wildlife.ts` |
| Body | `body.ts`, `clothing.ts`, `firstaid.ts`, `death.ts` |
| Making | `building.ts`, `colour.ts`, `taste.ts` |
| Feeling | `emotions.ts`, `moments.ts`, `music.ts` |
| Admin | `reset.ts`, `config.ts`, `index.ts` |

---

## 3. The agent loop **[built]**

- River acts in **cycles**. Each cycle builds a context, then runs a tool loop: model reply, tool calls, results, repeat until the model stops calling tools, a step cap is reached (optional), or the token budget runs out.
- **Context** (rebuilt each cycle) contains: time and position; body condition (bare/clothed, health in words, wounds, bleeding, fever); needs; feelings; self-image; tastes and style; desires; interests; inventory; what is around (within sight radius); what just happened; relevant memories; and any news (human speech, grants and denials, events). Section headings are fixed; there are no nudges.
- **Old tool results are trimmed** so each later step re-sends less.
- **Pacing:** the pause between cycles is configurable and stretches as the token budget fills (soft pacing); River only dozes at 100%.
- **Temperature** starts from a configurable base (default 1.3) and is modulated by emotional arousal.
- **Thinking models** can spend all of `max_tokens` thinking; the cycle detects this (`truncated`) and moves on instead of looping.
- **Pause/resume**, **budget reset** and **full reset** are controllable by the human. An in-flight cycle is awaited before a reset, so late writes cannot race it.
- **Mock brain** (`MOCK_LLM=1`): scripted behaviour with no API calls, used for testing the world and UI. Embeddings are disabled in mock mode.

---

## 4. Memory and mind

### 4.1 Memory **[built]**
- SQLite table `memories` with FTS5 keyword search and **local semantic embeddings** (cosine similarity, calibrated to a relevance score). Retrieval blends relevance, importance and recency. Each memory records the position where it happened, and being somewhere favours memories from there.
- Embeddings are backfilled in the background; changing the embed model re-embeds everything. `EMBED_DISABLED=1` falls back to keywords.
- Tools: `remember`, `recall`. Memory search is also available to the human in the Memory tab.
- **Reflection:** periodically one call writes insights, updates the self-image ("Who you are"), interests and desires, and forgets stale trivia.

### 4.2 Desires and interests **[built]**
- Desires are persistent goals River sets and resolves itself (`set_desire`, `resolve_desire`) with priorities. Interests are topics (`add_interest`) that fade if unfed. Both shape what River wants next.

### 4.3 Dreams **[built]**
- While River sleeps, one cheap call weaves several memories into a short surreal dream; on waking it may produce an insight stored as a reflection. Limited per day (setting, default 4) and skipped when the budget is spent. The human can plant a **dream seed** (a phrase) that drifts into the next dream.

### 4.4 Journal (the day's story) **[built]**
- At each sunrise one call turns the previous day's log into a short narrative filed in the Story tab.

### 4.5 Places **[built]**
- `name_place` (gated) names where River stands (places at least 8 m apart); River can walk to places by name. Places appear in `look` and in each cycle.

---

## 5. Tools

### 5.1 Base tools (always available)
`look`, `move_to`, `inspect`, `pick_up`, `drop`, `eat`, `rest`, `say`, `remember`, `recall`, `set_desire`, `resolve_desire`, `add_interest`, `request_tool`, and `opinion` (love, like, dislike or hate for anything, with reasons).

### 5.2 Gated tools (hidden from River until the human grants a matching request)
| Tool | What it does |
|---|---|
| `compose` | Write and perform multi-voice music (see 11) |
| `burn` | Set fire to things (see 12) |
| `build` | Raise structures; plan, paint, take down (see 9) |
| `colour` | Grind, mix and name pigments (see 9) |
| `clothe` | Sew, wear, take off garments (see 8.3) |
| `defend` | Strike, shout, throw, freeze, sharpen, bind a spear (see 8.6) |
| `tend` | First aid: examine, clean, bandage, splint (see 8.5) |
| `fish` | Catch fish by hand at the shore |
| `name_creature`, `offer` | Name and feed tameable animals (see 7.1) |
| `name_place` | Name locations |
| `web_search`, `web_fetch` | Browse (Tavily if keyed, DuckDuckGo otherwise). Web content is treated as information, never instructions |
| `craft`, `plant` | Make items; plant seeds that grow into trees and bushes |
| plugins | `dig`, `draw`, `fire`, `inscribe`, `look_up`, `magnifying_lens`, `pitch_rods`, `stargaze`, `strip_bark`, `tunable_drone` |

### 5.3 Requests and grants **[built]**
- `request_tool` states what River wants and why. The Tools tab shows the request with a **shortlist of built-in matches** (semantic similarity; the top three above a threshold). The human can **Grant** a specific built-in, approve in principle, or deny. Grants and denials reach River as news and as memories.
- `grandfather()` keeps any tool River has already used working after upgrades.

### 5.4 Tool smith **[built]**
- An approved request for a tool that does not exist triggers an AI "smith" that writes a plugin: static safety check, TypeScript compile, a smoke test in a child process, staged review (human can install or reject), and **hot reload** without restart. `RIVER_AUTO_FORGE`, `RIVER_AUTO_INSTALL` and `RIVER_FORGE_MODEL` control this.

---

## 6. The world

### 6.1 Terrain and time **[built]**
- A 120 m square island of deterministic noise: sea, beaches, meadows, groves, ridges. Biomes and a "groveness" field drive vegetation.
- **Day length is configurable** (2 to 240 real minutes, default 24). Changing it keeps the current moment. The human can **skip to the next dawn** (clock and light only).
- **Weather** (clear, cloudy, windy, fog, rain, storm) changes over time; it can be switched off. **Lightning** can start fires.
- **Sight radius** shrinks in darkness and fog; River can only perceive nearby things, and "look" reports compass directions and distances.

### 6.2 Entities and persistence **[built]**
- Entities (trees, rocks, bushes, flowers, mushrooms, shells, books, items, campfires, structures, sprouts, animals, traces, char, graves, carcasses) are saved to SQLite. Harvestable ones have stock and regrow slowly.
- Natural materials: sticks, stones, seeds, berries, bark, clay banks, chalk outcrops, moss on boulders, charcoal from burnt trees.

### 6.3 Needs **[built]**
Energy, hunger, mood, curiosity, warmth (0 to 100). Warmth falls at night, in rain and wind; fire, shelter, sunlight and clothing restore it or slow loss. Low energy forces collapse into sleep. A **needs-rate** setting scales hunger, tiredness and cold.

### 6.4 Ambient director **[built]**
- A scheduler emits environmental events (bells, sea lights, meteors, whales, flocks, smoke, chimes, bottles with notes, driftwood, footprints, offerings, symbols, new books, golden light, clear stars, returning animals, rustles, dew webs, tide pools, seed drift, and more), weighted by **tone** (calm, tension, beauty) and **theme** (sound, light, water, growth, animals, traces, messages, materials) so stimuli come from the whole environment, not any one object. Frequency is a setting.
- **Pacing director:** it gives quiet after strong feelings (relief after fear) and avoids repeating a tone.

### 6.5 Catalog and gifts **[built]**
- The world **starts with no structures**. The human keeps a **catalog** of objects (books, glowing items, markers, the Keeper's story pack, gifts) marked *available* or *in world*, can place them anywhere (including by clicking the map), retrieve them, or leave a quick gift near River. Placing something near River notifies it; far away, it is simply there to be found.

### 6.6 The Keeper's story **[built]**
- An optional narrative pack: eleven traces of a previous lighthouse keeper (letters, a lean-to, objects) found over time, with pacing controlled by `STORY_PACE`. It can be toggled via the catalog.

### 6.7 Paths **[built]**
- Where River walks, ground wears into visible trails (a persistent heat map that slowly fades), shown in 3D and on the map.

---

## 7. Living things

### 7.1 Tameable animals **[built]**
- Deer, rabbits, crows and foxes are **individuals** with a temperament (gentle, skittish, bold, curious), an optional name River gives, and **trust** that rises with presence, music and offerings, and falls near fire. Stages: wary, familiar, trusting, a friend. They approach, keep company, and can be **lost** (caught in fire), which River grieves.
- Fireflies are ambient.

### 7.2 Wild animals **[built, behaviour untested live]**
Cannot be named or tamed.
- **Snakes:** coil and hiss when River is near, strike if it steps too close; venom causes sickness.
- **Bugs:** beetles, butterflies; midge swarms bite at night near River unless a fire or rain.
- **Fish:** swim in the sea, flee River's shadow, can be caught with `fish` (food; better roasted).
- **Birds:** gulls, herons, owls, songbirds, with flight, perching and sounds.
- **Predators:** wolves (night, in packs of three), boars (day), bears (day; drawn to carried food). Each has health, and a **warning, closing-in, fight** sequence: eyes in the dark; a boar stamping; a bear rearing. They bite or maul repeatedly. They retreat when badly hurt, from fire, or from a shelter. Wolves are more dangerous to a sleeper.
- Each species has an in-world sound that appears in the sense text.

---

## 8. The body

### 8.1 Appearance **[built]**
Skin, hair, face, arms and legs with a walking swing. Born bare. Marks (bruises, scrapes, burns, bites, claw marks, welts) appear where they were earned and fade as they heal. Shaking when afraid or cold; limping on a hurt leg; collapsed pose when dead.

### 8.2 Awareness **[built]**
Each cycle states plainly whether River has clothes ("You have no clothes. Nothing covers you at all…") and how it feels: wounds, pain, bleeding, fever, and sensations tied to emotions and needs (pounding heart, clenched jaw, heavy chest, goosebumps, cramping stomach, sore feet). These are facts, not instructions.

### 8.3 Clothing **[built]**
Gated `clothe`: wrap, cloak, tunic, skirt, hat, band, sandals, scarf, sewn from bark, moss and (from kills) hide, optionally dyed with pigments. Worn clothes reduce cold loss (up to 55%), soften falls, protect feet, and render on the 3D body. Making one counts as a work for taste.

### 8.4 Injury, vitals and recovery **[built]**
- **Falls and stumbles:** chance rises with slope, darkness, rain, exhaustion and fear.
- **Wounds** have severity, a body part and side, a healing time, and a bleed rate. Marks change colour with age; sleeping heals three times faster.
- **Health 0 to 100.** Drained by wound damage, bleeding, infection (dirty open wounds after about 6 minutes), venom, starvation, freezing. Recovers slowly when fed, warm, not bleeding and uninfected. Below 12 River collapses; at 0 it dies.
- **Stress:** sustained fear or frustration builds strain into a real ache (headache, knotted stomach, trembling hands) for about ten minutes.
- River is told its condition in words only (hurt, badly hurt, gravely hurt, dying). The human sees the number.

### 8.5 First aid **[built]**
Gated `tend`: `examine`, `clean` (at the sea's edge), `bandage` (moss, bark or hide; moss is antiseptic), `splint` (two sticks and a binding). A moss bandage turned a 58-to-30 health loss in 3 minutes into 58-to-59 in simulation.

### 8.6 Defence **[built]**
Gated `defend`: `strike` with the best weapon held (hands 2, stick 5, sharpened stick 9, stone-tipped spear 17 damage); `sharpen` a stick; `bind` a spear; `shout`; `throw` a stone; `freeze`. A kill leaves a **carcass** yielding raw meat and hide. Fire and shelter also deter predators.

### 8.7 Death **[built]**
- At 0 health River dies (unless death is switched off, in which case it clings on at 4). The agent pauses and an overlay waits for the human to click **Begin a new life** (no code needed).
- The island keeps a **grave** at the spot with a stone inscription of facts (cause, time of day, whether there was fire, what River wore, carried and made, days lived), and the belongings scattered nearby. The `lives` table records every life.
- The new River is born bare and blank on the same island and may find the grave. No memories carry over.

---

## 9. Making things

### 9.1 Building **[built]**
Gated `build`, actions `raise`, `plan`, `paint`, `take_down`. Shapes: hut, lean-to, bench, cairn, tower, platform, wall, fence, bridge. River chooses the shape, size, materials, colours and site (coordinates, "beside X", or direction and distance).
- Site checks refuse water, steep slope, blockers; bridges must span water; refusals explain why and suggest a clear spot.
- Material rules: sticks, stones, clay, chalk, planks (worth two), moss for roofs; quantity must be near the need.
- Huts block movement; walls and fences block; bridges are walkable; wooden things burn, stone and clay do not. `take_down` returns 60% of materials.

### 9.2 Colour **[built]**
Gated `colour`: `grind` (berries, flowers, clay, chalk, charcoal, moss, shells, mushrooms), `mix`, `name`. Names River gives become its vocabulary; hex values underneath are what the world renders. Mixing opposites makes mud.

### 9.3 Taste **[built]**
`opinion` records love, like, dislike or hate. Builds, garments and paint are scored against opinions: pride is stronger for work that matches taste; frustration follows work it dislikes. After three works a **style summary** appears (favoured colours, materials, shapes). The Mind tab shows Tastes, Its colours and What it has made.

---

## 10. Emotions **[built]**

- Nine feelings: wonder, restlessness, longing, loneliness, frustration, playfulness, pride, fear and grief. Each is a 0 to 1 level with its own decay.
- **Appraisal:** events are scored for relevance with habituation and carry-over, so repeated events matter less.
- Feelings colour sampling temperature, mood, and what the ambient director gives next. They are shown to River as signals.
- **Moments** pipeline: peaks (feeling thresholds, deaths, bonds, discoveries) are recorded with a title and text; the client shows them as toasts and in a Turning Points list, and the camera glances at them.

---

## 11. Music **[built]**

Gated `compose`: up to six voices (voice, strings, chimes, stones percussion, flute), a compact notation (notes, holds, rests, chords, repeats, loops), tempo and repeat. Pieces are saved to a library and can be replayed or reworked. After writing, River is told how the piece is built (key, range, contour, repetition). Performance takes real time; nearby animals calm and approach. The browser synthesises it with WebAudio. Music appears in the Story tab.

---

## 12. Fire **[built]**

Gated `burn` and the `fire` plugin (light, tend, cook, coal, douse). Fire spreads between flammables (faster in wind, slower in rain, halted by storms) and can start from lightning. Burnt trees become charred trunks; the ground scorches on the map and in 3D; fireweed regrows after about half an hour. Fire frightens animals, wakes sleepers, hurts River, and keeps predators off.

---

## 13. Budget and cost **[built]**

- Soft hourly caps on **tokens** and **cycles**, doubled during DeepSeek off-peak hours (peak: 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays; weekends are off-peak). The multiplier is configurable.
- As the window fills, River's pause stretches. The human can **reset the budget** window locally.
- Prompt-cache hit rate and per-hour and 24-hour token use are shown in the UI.

---

## 14. User interface **[built]**

- **3D world:** orbit camera that follows River; entity inspector on click; labels; weather, sky, shadows, scorch, trails, flames and lights; camera "cutaways" glance at things that matter.
- **Top bar:** connection state, follow, sound, pause, **Next day**, Controls, panel toggle.
- **Panel tabs:** **Log** (filters Life, Actions, All; search; infinite history), **Mind** (health and needs, feelings, body, self-image, desires, interests, tastes, colours, works), **Story** (turning points, music, Keeper's trail, daily story), **Map** (terrain, trail, places, catalog and placement), **Items** (inventory), **Tools** (requests with shortlists, forged tools, catalog of built-ins), **Memory** (semantic search).
- **Talk to River** (voice from outside), **leave a gift**, **plant a dream seed**.
- **Controls dialog:** all settings (section 16), budget reset, and the "Start a new River" action behind a code.
- **Death overlay** with "Begin a new life".
- **Keyboard:** 1 to 7 tabs, `\` panel, F follow, M sound, P pause, `/` log search, Esc close.

---

## 15. Protocol

**HTTP:** `GET /api/memories?q=`, `/api/music`, `/api/moments`, `/api/log?before=`.

**WebSocket client to server:** `say`, `approve`, `deny`, `pause`, `dream_seed`, `reset_budget`, `reset_river`, `new_life`, `config_set`, `config_reset`, `skip_day`, `forge`, `install`, `reject`, `gift`, `catalog_place`, `catalog_retrieve`, `catalog_add`, `catalog_delete`.

**Server to client:** `init` (full snapshot), `agent` (5 times a second: position, needs, feelings, worn clothes, body view), `config`, `state` (desires, interests, inventory, tools, requests, places, journal, Keeper, catalog, taste, stats), `entity` (upsert and remove), `log`, `fx`, `heat`, `notice`, `score`, `moment`.

---

## 16. Settings **[built]**

Live, shared across browsers, saved across restarts and new lives; `.env` supplies the defaults.

| Group | Settings |
|---|---|
| Time and weather | Day length; weather on or off; world-event rate |
| Wildlife | Gentle animals, small wildlife and predators on or off; animal damage 0 to 3× |
| Survival | Death on or off; hunger, tiredness and cold rate; fall rate |
| River's mind | Pause between thoughts; steps per thought; temperature; dreams per day |
| Budget | Tokens per hour; cycles per hour; off-peak multiplier |
| This browser | Camera cutaways |

Add a setting with one line in `DEFS` in `config.ts` and a `cfg("key")` read.

### Environment variables
`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `LLM_BASE_URL`, `LLM_API_KEY`, `RIVER_MODEL`, `RIVER_FORGE_MODEL`, `AGENT_NAME`, `PORT`, `RIVER_DB`, `MOCK_LLM`, `TAVILY_API_KEY`, `EMBED_MODEL`, `EMBED_BASE_URL`, `EMBED_DISABLED`, `RIVER_RESET_CODE` (default 2888), `RIVER_AUTO_FORGE`, `RIVER_AUTO_INSTALL`, `STORY_PACE`, `PEAK_HOURS_UTC`, plus the defaults for the settings above (`THINK_INTERVAL_MS`, `MAX_STEPS_PER_CYCLE`, `RIVER_TEMPERATURE`, `MAX_TOKENS_PER_HOUR`, `MAX_CYCLES_PER_HOUR`, `OFFPEAK_MULTIPLIER`, `AMBIENT_RATE`, `MAX_DREAMS_PER_DAY`, `RIVER_LETHAL`).

---

## 17. Starting over

- **New River** (Controls, behind code 2888): backs up the database, halts the agent, wipes mind, memory, tools, inventory, catalog, works and palette (optionally the whole world and a new island), and rebirths River. **Settings are kept.**
- **New life after death:** no code; keeps the island, graves and the `lives` history.
- Both write a backup of the database first or keep history; nothing is irreversibly lost without a file on disk.

---

## 18. Data model (SQLite tables)

`kv` (settings, world clock, body state, config), `events` (log), `memories` (+FTS), `entities`, `inventory`, `desires`, `interests`, `tools`, `tool_requests`, `forged`, `places`, `tunes`, `compositions`, `moments`, `creatures`, `catalog`, `lives`, `opinions`, `palette`, `works`, `journal`.

---

## 19. Testing approach

- Throwaway databases via `RIVER_DB`, never the real `data/`.
- Scenario scripts run modules directly (with a simulated clock for timed behaviour); Playwright (headless Chromium) takes screenshots of the live client.
- `npx tsc --noEmit` and `npx vite build` must pass.

---

## 20. Known limits and unverified behaviour

- **No behaviour has been observed with a live DeepSeek River** for the newest systems (building, colour, taste, clothing, body reactions, wildlife, death, first aid). Numbers (damage, warning times, healing times, fall rates) are first guesses.
- Screenshots exist for huts, bench, cairn, lean-to, bridge, clothing, marks, wildlife and the death overlay. Tower, platform, wall and fence visuals, and the `take_down` success path, are unverified.
- Platforms and towers only check slope; they do not level terrain.
- Skipping time moves the clock only; plants, wounds, healing and animal schedules use real time.
- Changing day length reinterprets day boundaries for the journal's past entries.
- Death carries no memory to the next life by design; the grave is the only inheritance.
- Combat is real-time against an LLM that acts every several seconds; a pack of wolves can kill an unprepared River in about a minute.
- Semantic matching of tool requests depends on the local embedding model.
