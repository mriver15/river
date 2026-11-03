# River World: roadmap

Guiding principle: **stimuli, never instructions.** The world can surprise River, remember River, and respond to River, but it doesn't hand River goals, hints or rewards. Anything that costs tokens must be rare (a dream, a daily story) or free (sound, trails).

Status: ✅ built · 🚧 partly built · 💡 designed, not built

## Batch 2 (this pass)

### ✅ Dreams
While River sleeps (resting, or collapsing from exhaustion), one cheap model call weaves 3–5 memories (recent ones plus random older ones) into a short surreal dream. On waking, River may realise something: that insight is stored as a reflection, the dream is stored as a memory, and the dream nudges mood. Limits: at most a few dreams per world day, none when the token budget is spent.
- **Dream seeds:** you can plant a phrase before River sleeps (the ☾ button). It drifts into the next dream as "a thought from outside". It's influence without instruction, and River may never mention it.

### ✅ Places that remember
- **Named places:** River can name where it stands (`name_place`) and walk to places by name. Places are listed in `look` and in each cycle, so it always knows where it is relative to the things it has named.
- **Memories know where they happened.** Every memory records a position. Recall favours memories from the current place, so walking back to the mossy hollow brings back what happened there.
- **Map tab:** terrain, River's trail, named places and landmarks.

### ✅ Desire paths (the island remembers River)
Walked ground slowly wears into visible dirt trails. The heat-map persists, fades if unused, and shows in the 3D world and on the map. Habits become geography, at zero token cost.

### ✅ The day's story
At each sunrise, one call turns the previous day's log into a short narrative and files it in the **Story** tab. This is the readable record of River's life.

### ✅ Sound
Procedural browser audio (off until you click 🔊): wind, rain, surf (louder near water), night insects, campfire crackle, thunder, and the monolith's hum, whose pitch follows its in-world shifts.

## Batch 3 (sandbox)

### ✅ Fire and permanence
`src/server/fire.ts`. River can set things alight (`burn`) and fight fires. Fire spreads between nearby flammables (faster in wind, slower in rain, stopped by storms), can be started by lightning, scares animals, wakes sleepers, and hurts anything standing in it. What burns *stays* burnt: trees become charred trunks, small plants and loose books vanish, the ground stays scorched on the map and in 3D, and after about half an hour fireweed starts to grow back. This is the first system where one choice has long-lived, irreversible consequences. **Back up `data/river.db` before big experiments**; there is no undo.

### ✅ Music as something River arrives at (first half of Resonance)
River is *not* handed an instrument. Its own voice, strings, chimes and stones are always available through `compose`; a wind instrument has to be found or made. Playing calms shy animals so they drift closer, and the monolith answers if River sounds the pitch it is currently humming (it starts on A and drops a semitone per shift); each answer makes it glow brighter permanently. (An earlier version left a flute by the campfire; that was removed as a hidden instruction.)

### ✅ Budget that bends
Token and cycle caps are time-aware (DeepSeek is half price off-peak) and soft: River slows as the hour's budget fills and only stops at 100%.

## Batch 4 (emotional design)

### ✅ Appraisal, pacing director, moments
See the README. Also built from the same analysis: individual named creatures with trust (so a loss can be personal), the serialized Keeper's trail, biomes and vistas, and a colder, darker night (a warmth need, limited sight). Still to do: leitmotifs and an adaptive soundtrack, challenges with learnable tells (the rope bridge), and the hypothesis ledger.

## Next (designed)

### ✅ Resonance: music and the monolith
Multi-voice composition (`compose`) and the monolith's answers are built. Still to do: bigger responses at higher resonance counts (a light, a new object), and other things on the island that respond to specific music.

### 💡 Hypothesis ledger
River records claims about the world ("the hum drops before rain") with a confidence that rises and falls with evidence it logs. The store makes testing visible: you can watch River's beliefs get confirmed, refuted or quietly abandoned. It gives River something like science without telling it to do science.

### 💡 Letters out, bottles back
A `write_letter` tool leaves messages for you in a mailbox tab. Your replies arrive diegetically, as bottles on the shore hours later, instead of as an instant voice from the sky. It makes the relationship slower and stranger, and River's own.

### 💡 Time capsules
`bury` plus `dig`: River can bury a note (or an item) for its future self, optionally "open on day N", and rediscover it later. This is memory stored in the world.

### 💡 Visitors and barter
A trading boat arrives now and then, with a fixed barter table and no model calls. It brings items from beyond the island (new kinds of materials, objects with stories) and gives River an economy to make choices in.

### 💡 The felt presence
When you connect, River gets a faint sense of being watched, which is a sensation and not a message. Some Rivers will notice and some will ignore it. It's cheap and might be the most revealing stimulus.

### 💡 Generations
An optional finite life. When it ends, a new River inherits a distilled "lore" and the old River's structures, trails and graves remain. It tests what lasts: memory, or the marks left on the world.

### 💡 Seasons and ecology
Seasons change day length, plants and animals, and actions get consequences that ripple (rabbits eat berries, stripped trees stay dead, planted groves spread).

### 💡 Second inhabitant
Another agent, or a scripted wanderer who only uses the model when talked to, so River has someone to remember, trust or avoid. The cost doubles, so this should come after the cheaper ideas.

### 💡 Hybrid brain
A small local model for routine steps (walking, gathering) and DeepSeek for deliberate decisions. This cuts cost the most, but behaviour becomes harder to predict.

### 💡 Time-lapse replay
Record positions and events, then replay a day at 60× in the 3D viewer, with trails. Useful for watching River's life like a nature documentary.

### ✅ Making: place, material, colour, taste
River can choose a site, gather materials, grind and name its own pigments, build nine shapes, and hold opinions that shape its style. See the README section "Making things". Next ideas: terrain levelling for platforms and towers, gifting pigments or tools, and River critiquing the human's gifts.
