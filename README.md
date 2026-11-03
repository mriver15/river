# River World

River is an always-live agent that lives its own life on a persistent 3D island. The brain is DeepSeek.

- **Brain** – DeepSeek (OpenAI-compatible API), run in repeated "cycles" (state snapshot → several tool calls → summary). `src/server/agent.ts`, `llm.ts`
- **Memory** – SQLite + FTS5. Retrieval = relevance + importance + recency. Periodic reflection writes insights, updates a self-image, interests and desires; stale trivia is forgotten. `memory.ts`, `mind.ts`
- **World** – deterministic island + persistent entities, inventory, needs, day/night, regrowth, growing plants. `world.ts`
- **Tools** – a base set; `web_search`, `web_fetch`, `craft`, `plant`, `build` stay locked until you approve River's request. River can also invent tools that don't exist ("new tool idea"). `tools.ts`, `web.ts`
- **UI** – three.js world, full action log with filters, mind/needs/desires/interests, inventory, tool requests, memory search, talk to River, leave gifts.

## Run

```bash
npm install
cp .env.example .env      # set DEEPSEEK_API_KEY
npm run dev               # http://localhost:5173
MOCK_LLM=1 npm run dev    # scripted brain, no API calls
```

State lives in `data/river.db`; delete it to start a new life. `MAX_CYCLES_PER_HOUR` is the hard cost cap.
Web text is untrusted, and `web_fetch` refuses localhost/private addresses. River has no shell/file tools, so the blast radius is the island.

## Adding a tool

River asks for tools in the Tools tab. Approving a *catalog* tool (`web_search`, `craft`, …) switches on code that already exists. Approving a *new tool idea* only records it; to make it real, write a plugin:

1. Create `src/server/plugins/<name>.ts` with a default-exported `ToolDef` (see `plugins/dig.ts`). `name` must match what River requested.
2. Use the `World` (`w`) to do things: `w.me` (position, needs), `w.nearby(r)`, `w.entities`, `w.addItem/takeItem/findItem`, `w.spawn(kind, …)`, `w.bump({curiosity: -5})`. Throw `ToolError("…")` for normal failures, which River sees as feedback.
3. Restart. The tool shows up as locked in the catalog and goes live immediately if you already approved a request with that name. Otherwise River has to ask (or you approve its next request).

A new visible entity kind also needs adding to `EntityKind` in `shared/types.ts` and a mesh in `client/scene.ts` (`pit` is an example).

## Cost and local operation

- Every LLM call (cycles, reflection, tool smith) is counted. The header shows tokens/hour and the cache-hit rate; `MAX_TOKENS_PER_HOUR` makes River doze when it's reached. A cycle costs roughly 20k tokens (mostly cached prefix) on the default settings, so the default cap allows about 25–30 cycles an hour.
- Levers, biggest first: `THINK_INTERVAL_MS`, `MAX_STEPS_PER_CYCLE`, `MAX_TOKENS_PER_HOUR`.
- Already local: world, inventory, memory (SQLite + full-text search), log, and the UI. Remote: only the LLM endpoint and the web tools.
- Fully local: set `LLM_BASE_URL=http://localhost:11434/v1` and `RIVER_MODEL=<a tool-calling model you have pulled>`. No API key is needed for localhost.

## Semantic memory

Memories are embedded locally with Ollama (`ollama pull mxbai-embed-large`; `nomic-embed-text` also works) and stored as vectors in the same SQLite file. Recall blends meaning (cosine similarity), keywords (FTS), importance and recency, so "I felt starving" finds the memory about being hungry. Embedding happens in the background and never blocks River; if Ollama is down it falls back to keyword search, and older memories are indexed once it's back. The Memory tab shows how many are indexed.

## World stimuli

`src/server/ambient.ts` gives the island a life of its own. None of it is a quest, hint or reward.

- **Weather** (clear, cloudy, rain, fog, wind, storms) changes the look, River's mood slightly, and how fast seedlings grow. After rain, mushrooms appear.
- **Wildlife** (deer, rabbits, crows, a night fox, fireflies) wanders and flees when River gets close.
- **Senses:** `look` and each cycle include the weather and sounds (surf, the monolith's hum, crickets, rain).
- **Strange happenings** at random intervals: distant bells and lights, shooting stars, messages in bottles, driftwood, footprints that fade, a ring of pebbles at the shrine, a spiral scratched on a rock, new books in the library, the monolith's hum shifting.
- The log's **world** filter shows everything that happens. Entries River was too far away to notice are dimmed and marked "unnoticed". `AMBIENT_RATE` scales the frequency.

## Batch 2: dreams, places, paths, stories, sound

See `docs/ROADMAP.md` for the full list and what's next.

- **Dreams** (`dreams.ts`): sleeping weaves memories into a dream and sometimes an insight. ☾ plants a thought in the next one. At most `MAX_DREAMS_PER_DAY` (default 4).
- **Places** (`places.ts`): `name_place`, walk to places by name, memories recall better where they happened. Map tab.
- **Worn paths**: where River walks, the ground in the 3D view and on the map wears into trails; unused trails fade.
- **Story tab** (`journal.ts`): a short narrative of each finished day.
- **Sound** (`client/audio.ts`): 🔊 in the header (browsers need a click to start audio).
- DeepSeek's `deepseek-flash` thinks before answering and thinking counts against `max_tokens`. If you ever see "ran out of tokens while thinking" in the log, raise the limit for that call.

## Batch 3: fire, softer budget

- **Music:** see the Music section below. (There used to be a flute left by the campfire; it was removed, because handing River an instrument is an instruction in disguise.)
- **Fire** (`fire.ts`): `burn` ignites or smothers. It spreads, scorches, destroys and regrows, and it is permanent. Back up `data/river.db` before experiments. Lightning during storms can start one.
- **Budget:** 1.5M tokens/h and 240 cycles/h at peak, double off-peak (DeepSeek bills half price then). River slows as the budget fills instead of stopping dead. `RIVER_TEMPERATURE` (default 1.3) widens its choices.

## The interface

- **Header:** River's state at a glance (activity and four need meters), the time and weather, a budget meter (hover for tokens and cycles), and controls for follow-camera, sound, pause and hiding the panel.
- **Panel tabs:** Log, Mind, Story, Map, Items, Tools, Memory. Drag its left edge to resize; hide it to see the whole world (the camera keeps River centred in the visible area).
- **Log:** *Life* shows River's inner life (thoughts, speech, dreams, world events, desires), *Actions* shows what it did and saw, *All* shows everything. Use the filter button to pick kinds and the search box for text. Dimmed entries are things River didn't notice.
- **Tools:** *Requests* (approve or deny, with an optional note), *Toolbox* (searchable, grouped: unlocked, locked, built in; click a row for its description), *Smith* (tools awaiting your review first, installed ones collapsed).
- **Notifications** appear for tool requests, tools ready for review, dreams, fire and danger.
- **Keys:** `1`–`7` switch tabs, `/` searches the log, `\` hides or shows the panel, `F` follow, `M` sound, `P` pause, `Esc` closes the inspector. Click anything in the world to inspect it.

## Controls, and starting over

The sliders button in the header opens **Controls**:

- **Reset budget & restart cycles** clears the local token and cycle counters and any error backoff, and wakes River immediately. It only resets the local meter; it doesn't change what DeepSeek bills.
- **Start a new River** erases River's whole mind (memories, desires, interests, dreams, stories, places, tunes, inventory, log, unlocked and requested tools) and optionally generates a new island too. It needs a confirmation code (`2888` by default, set `RIVER_RESET_CODE` to change it); five wrong tries lock it for a minute. The check happens on the server. Before erasing anything, the whole database is saved to `data/backups/river-<timestamp>.db`. To go back, stop the server and copy a backup over `data/river.db`. Installed tool code stays on disk; a new River finds those tools locked until it asks for them.

## Music

River composes with the `compose` tool: up to 6 voices (voice, strings, chimes, stones, and a wind voice only if River is carrying something to blow through, which it has to find or make) in a small text notation (`D4 F#3:2 _ [D3 A3]:4 (C4 E4)x2`, percussion `k s h c t`), tempo, repeats, looping voices. Pieces are saved (they survive restarts, and are wiped by a new River), performed in the world (animals stop to listen; the monolith answers if the piece leans on the pitch it's currently humming), and described back to River (key, range, contour, repetition) since it can't hear them.

- **Where to listen:** the *Music* section of the **Story** tab lists everything River has written; play it, save it as `.wav`, or try the built-in demo to test your speakers. A now-playing chip in the header links there.
- When River starts performing and sound is off, a prompt offers to let you listen (browsers only start audio from a click).
- The synth is in `src/client/music.ts`; the notation and its analysis in `src/shared/music.ts`.
- The old "sharp chirp" was the night-insect layer: its tremolo ran even at zero volume. Fixed; ambience levels were also raised so the bed is audible.

## Feelings

River has nine feelings beside its needs: **wonder, restlessness, longing, loneliness, frustration, playfulness, pride, fear and grief** (and a derived *bittersweet* when joy and sorrow overlap). They live in `src/server/emotions.ts`; names, colours, descriptions and decay times in `src/shared/emotions.ts`.

- **Triggers:** events nudge them. Failed tools build frustration (faster when repeated); doing the same things again builds restlessness; silence builds loneliness (slowly, easing with animals and your voice); wonder follows strange sights, reading, discoveries and the monolith answering; fire and storms in the dark bring fear; burnt books, buildings and trees bring grief; finishing things brings pride; old places can stir longing.
- **They fade** at different speeds (fear in minutes, grief in the better part of an hour).
- **Effects:** River is told how it feels each cycle, as signals and not orders. Arousal widens its sampling temperature. Feelings colour its dreams, and sleeping takes the edge off heavy ones. Plain mood drifts with overall valence. Music carries feelings away: a wistful piece eases longing, grief and loneliness, an agitated one frustration and fear, a bright one nothing but it adds pride.
- **You can see them:** feeling chips under River's needs, a Feelings section in the Mind tab, and "feeling" entries in the log when one rises strongly (with the cause).
- To tune it, edit the rates in `emotions.ts` and the half-lives in `shared/emotions.ts`.

## Appraisal, pacing and moments

Based on the ideas in Tynan Sylvester's *Designing Games* (emotion comes from meaningful change that is understood):

- **Appraisal** (`emotions.ts`): an event's feeling isn't fixed. It is scaled by *relevance* (how closely it bears on River's desires, interests and named places, via the local embeddings), by *habituation* (familiar things lose their force and recover over about two hours), and by *carry-over* (arousal already present amplifies what comes next, and turns an ambiguous sign like footprints or a bell from wonder into fear when River is already afraid). First times count extra.
- **Pacing director** (`ambient.ts`): happenings have a tone (calm, beauty, mystery, spectacle, tension). After strain the world offers quiet and beauty; after a long calm it offers surprise; when fear passes it offers something gentle (golden light, stars, a deer that stays). It won't interrupt River while it is absorbed in making something.
- **Moments** (`moments.ts`): a large enough change in feeling becomes a moment. It gets a toast, a short musical mark (if sound is on), a glance of the camera toward where it happened (the camera never fights you: touching it cancels the glance and pauses the director for 8 seconds), an entry in the **Story** tab's *Turning points*, and it becomes the backbone of the next day's story.

## Creatures, the Keeper, biomes, cold and dark

- **Individual animals** (`creatures.ts`): every deer, rabbit, crow and fox is somebody, with a temperament (gentle, skittish, bold, curious), a persistent identity (the same crows come back each day; night animals wait offstage), and a **trust** in River that grows with time near it unthreatened, music, and offerings (`offer`: deer take berries and flowers, rabbits berries and mushrooms, and so on) and falls with fire. Trusted animals let River closer, then keep company, and a friend stays by River's side even when it is dangerous, which is how they get lost. River can give one a name (`name_creature`); a name is permanent. Losing a named, trusted animal is grief on a different scale from losing a tree.
- **The Keeper's trail** (`story.ts`): eleven pieces left in the world over a couple of hours (bottles, a collapsed camp, two logbooks in the library, strokes at the monolith, an unposted letter, pebbles at the shrine), placed near River, each recasting the earlier ones, and tied to how the monolith really behaves. The last waits until the rest are found, then a lamp is lit at the shrine (light and warmth). The Story tab shows what River has found. `STORY_PACE=2` doubles the speed.
- **Biomes** (new islands): trees gather in groves by height and moisture (pines on ridges, willows low), flowers grow in single-colour meadow patches, berries sit where grove meets meadow, and two **lookout stones** give a vista (`look` lists what can be seen from a height). The ground tints darker in groves and warmer in meadows. Existing islands keep their layout; "Start a new River" with a new island gets this.
- **Warmth** is a fifth need. Night, rain, storms and wind drain it; fire, the sun, a lamp, a shelter (any structure nearby) and hot food restore it. Cold wears down energy and mood, and deep cold brings fear.
- **Sight** closes in at night (about 11m), in fog and in storms; a fire or lamp pushes the dark back (26m). River is told when it can't see far.
- A **rustle in the dark** happens at night: a sound just past sight that resolves, after a while, into a fox or nothing.

## A blank start

River is born with a body and a mind, and nothing else.

- **Body:** `look`, `move_to`, `inspect`, `pick_up`, `drop`, `eat`, `rest`, `say`. **Mind:** `remember`, `recall`, `set_desire`, `resolve_desire`, `add_interest`, and `request_tool`.
- **Everything else is asked for:** music (`compose`), fire (`burn`), naming places and creatures, feeding animals, crafting, planting, building, the web, and every tool the smith has written. River has to want a thing, say what it is in its own words, and ask. A human decides.
- **River is never shown a menu.** Its prompt doesn't name locked tools or suggest activities, the per-cycle context has no "capabilities" list, the `request_tool` description names nothing, and tool results don't hint at things it lacks. Nothing is lying around to be picked up as an instruction (no starting flute, nothing in the inventory).
- **For you:** requests arrive in River's words ("I want to put the sounds together…"). The local embeddings compare them with what already exists and show a shortlist of strong matches, so you can **Grant** an existing ability (River is told what it is called and does) or **Build a new one** with the tool smith. A request that matches nothing is just Approve.
- **A life already in progress keeps what it used:** tools that used to be built in (`compose`, `burn`, `name_place`, `name_creature`, `offer`) stay unlocked for a River that has already used them.
- Stimuli are still part of the world (books, animals, the Keeper, weather). Those are things to find, not instructions.

## The catalog: a world that starts empty

A new island has nature only: terrain, trees and groves, bushes, flowers, mushrooms, shells, rocks, animals, weather. **No structures.** The things that used to be generated (the Old Library and its six books, the Hilltop Shrine, the Humming Monolith, the Campfire Ring, two lookout stones) and **the Keeper's trail** are catalog entries, and so is anything you add yourself.

- Each entry is **available** (in the box) or **in world** (placed). A placed entry that River has picked up or that is gone shows as **taken**.
- **Where:** in the **Map** tab, under *Structures & gifts*. Place an entry *near River*, at its *usual spot*, or **on the map** (click anywhere on the island); *move* it the same way; *take it out of the world* to put it back in the box.
- **Gifts:** *Add a gift…* (or the gift button by the composer) makes your own: a name, what River sees when it looks closely, optional readable words, whether it is fixed in place, whether it glows (light and warmth). Gifts are catalog entries too, so you can take them out and place them again.
- **The Keeper's trail** is a switch: on, it leaves its eleven pieces over a couple of hours; some pieces need the library, monolith and shrine to exist and wait for them. Off, the whole story goes back in the box.
- A world that already had structures keeps them: they are adopted as "in world" the first time the server starts, and you can take any of them out.
- If something appears within about 15m of River, River notices it; farther away, it is simply there to be found.

## Stimuli come from the whole environment

The director no longer lets any one kind of happening dominate. Each happening has a **theme** (sound, light, water, growth, animals, traces, messages, materials), and a theme is less likely the more of the last few happenings were about it. In a world with the library, monolith and shrine all placed, this cut the longest same-theme run from 5 to 3 and the share of sound from 30% to 24% at night; in a world without them, sound is about 7% by day. New happenings that aren't about sound at all were added: dew on every web at dawn, a mirror-still tide pool, and drifting seeds that really do sprout into flowers.

## Making things: place, material, colour, taste

River's `build` tool is gated like everything else: it must ask for it. Once granted:

- **Where.** `build plan` checks a site (water, slope, trees and rocks in the way) and suggests a clear spot. `raise` refuses with a reason if the site is bad. Bridges must span water.
- **Materials.** Each shape (hut, lean-to, bench, cairn, tower, platform, wall, fence, bridge) needs real materials from the inventory: sticks, stone, clay, chalk, moss. Clay banks, chalk outcrops and moss are seeded into the world (`ensureMaterials`, so older worlds get them too). `take_down` returns 60%.
- **Colour.** The `colour` tool grinds pigments from things in the world (berries, flowers, clay, chalk, charcoal, moss, shells, mushrooms), mixes them and names them. River's palette is its own; no colour is offered.
- **Taste.** The `opinion` tool (always available) records love/like/dislike/hate for anything. Builds are tagged and scored against those opinions. Pride is stronger when a work matches its taste, and frustration follows a work it dislikes. After three works a style summary appears in its context and in the Mind tab (Tastes, Its colours, What it has made).
- **Effects.** Walls and huts block movement, bridges are walkable, and wooden things burn. Stone and clay do not.

Code: `src/server/building.ts`, `colour.ts`, `taste.ts`. Not yet tested against live DeepSeek.

## A body, and what covers it

River is born bare, and its context states this as plain fact each cycle (`bodyText`); nothing tells it what to do about it. The old built-in scarf is gone, and the model now has skin, hair, a face, arms and legs that swing as it walks.
- **Clothing is a gated tool**, `clothe`, which River has to ask for. It sews wraps, cloaks, tunics, skirts, hats, bands, sandals and scarves from strips of bark (new: trees yield it) and moss, and can dye them with pigments it has ground. Then it can `wear` and `take_off` them.
- **Worn clothes matter.** They cut night and weather chill (up to 55%) and show on the body in the 3D world, in its chosen colours. Making one counts as a work for its taste and style.

Code: `src/server/clothing.ts`, `dress()` in `src/client/scene.ts`. Tested with a throwaway world; not yet with live DeepSeek.

## A body that reacts

`src/server/body.ts` makes River's body answer to its life. It is reported to River as sensation, never as an instruction.
- **Falls.** While walking, the chance of a fall rises with steep ground, darkness, rain, tiredness and fear. A fall stops the walk and leaves a bruise, scrape or (at the ankle) sprain on a specific side and part. A body garment softens it a little.
- **Fire.** Standing too close to a fire burns a hand, forearm or shin.
- **Healing.** Marks change colour as they age (a bruise goes red, purple, green, then yellow), heal in about 15 to 100 real minutes, and heal three times faster while River sleeps. Pain drags mood down while it lasts.
- **Feelings in the body.** Fear brings a pounding heart and shaking hands, frustration a clenched jaw, grief a heavy chest, and wonder goosebumps. Cold, hunger, tiredness and long walking (worse barefoot) are felt too. Stress that goes on turns into a real ache, such as a headache or a knot in the stomach, for about ten minutes.
- **Where it shows.** River's context gets a "How your body feels" section when anything is noteworthy. The 3D body shows the marks where they are, trembles when afraid or cold, and limps on a hurt leg. The Mind tab has a Body section.
- **Memory.** A fall or a burn is stored as a memory, so River can learn from it.

## Wildlife and threats

`src/server/wildlife.ts` adds a wild island next to the tameable deer, rabbits, crows and foxes. These animals can't be named or tamed.
- **Snakes** lie coiled and hiss when River comes close, and strike if it steps too near. A bite can be venomous (a sickness for 10 to 16 minutes).
- **Bugs.** Beetles and butterflies are harmless. Midge swarms come out at night, follow River and leave itchy welts, unless there's a fire or rain.
- **Fish** swim in the sea and flee from River's shadow. The gated `fish` tool lets River catch one by hand at the water's edge. Fish is food, and better roasted.
- **Birds.** Gulls circle the shore, herons stand in the shallows, owls watch from trees at night, and songbirds flit about by day.
- **Predators.** Wolves (night) circle, then rush in, and are more likely to attack River while it sleeps. Boars (day) snort and stamp, then charge. Bears (day) rear up, huff, and sometimes bluff-charge, and they are drawn to food River is carrying.
- **Responses.** Every threat gives a warning first. A lit fire or a shelter keeps predators away. The gated `defend` tool adds `shout`, `throw` (a stone) and `freeze`. Nothing is told to River, so it has to work these out or ask for them.
- **Cost.** Attacks leave real wounds and can kill (see "Death, injury and recovery"). Fear rises as a predator closes in.

## Death, injury and recovery

River has health (0 to 100) and can die. Set `RIVER_LETHAL=0` to turn death off; River then clings on at 4 health.
- **How health falls.** Wounds do direct damage (wolf bites about 8 to 16, boar goring 15 to 28, bear claws 24 to 42). Open wounds also bleed, slowly clotting over about 2.5 minutes (about 20 seconds when bound). Dirty open wounds turn infected after about 6 minutes and bring fever and then sepsis. Venom, starvation and freezing drain health too.
- **How it recovers.** Health returns slowly when River is fed, warm, not bleeding and uninfected, three times faster while asleep. Below 12 health River collapses.
- **Fighting back.** Predators have health and fight to the end: a wolf bites every few seconds (a pack of three kills an unprepared River in about a minute), a boar gores twice, and a bear swipes three times and then loses interest in something that lies still. They retreat when badly hurt, or from fire or a shelter. The gated `defend` tool can `strike`, `shout`, `throw` and `freeze`. It can also `sharpen` a stick and `bind` a stone-tipped spear (damage 17, reach 2.7). A kill leaves a carcass to butcher for raw meat (cook it) and hide (sewn into clothes or used to bind).
- **First aid.** The gated `tend` tool has `examine`, `clean` (at the sea's edge), `bandage` (moss, bark or hide), and `splint` (a sprained joint). Moss is antiseptic.
- **Awareness.** River is told how it is in words (hurt, gravely hurt, dying, bleeding, feverish) and never in numbers. The numbers are for the human, in the Mind tab.
- **Dying.** The world stops and an overlay waits for a human to click "Begin a new life" (no code needed). The old life is saved in the `lives` table. A **grave** stays where River fell, with the facts of that life on it (cause, time of day, whether there was fire, what it carried, wore and made), and its belongings are scattered nearby. The new River is born bare and blank and may find the grave.

## Settings and time control

The sliders button (Controls) now opens a settings panel. Every value is live, shared by all open browsers, and saved across restarts and new lives. `.env` values are only the defaults.
- **Time & weather:** day length (2 to 240 real minutes, the time of day is kept when you change it), weather on or off, and how often world events happen.
- **Wildlife:** gentle animals, snakes and bugs and fish and birds, and predators can each be switched off, and animal damage can be scaled from 0 to 3×.
- **Survival:** death on or off, how fast hunger, tiredness and cold build (0 to 3×), and how often River trips.
- **River's mind:** pause between thoughts, steps per thought, temperature, dreams per day.
- **Budget:** tokens per hour, cycles per hour, off-peak multiplier.
- **This browser:** camera cutaways on or off.
- **Next day:** the sunrise button in the top bar (and a button in the settings) skips ahead to the next dawn. It moves only the clock and the light, so plants, wounds, healing and animals don't age with it.

Code: `src/server/config.ts` (add a setting by adding a line to `DEFS` and reading it with `cfg("key")`), `src/client/ui/settings.ts`.
