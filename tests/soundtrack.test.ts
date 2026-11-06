import test from "node:test";
import assert from "node:assert/strict";
import { moodFor } from "../src/client/soundtrack.ts";
import type { AgentView } from "../src/shared/types.ts";

const view = (o: Partial<AgentView> & { health?: number; bleeding?: boolean } = {}): AgentView => ({
  name: "River", x: 0, z: 0, heading: 0, activity: "", speech: null, sleeping: false, worldTime: 0.5, weather: "clear", feelings: {}, day: 1, thinking: false, worn: [],
  needs: { energy: 80, hunger: 80, mood: 70, curiosity: 50, warmth: 70 },
  body: { marks: [], shaking: 0, limp: false, sensations: [], health: o.health ?? 100, bleeding: o.bleeding ?? false, infection: 0, lives: 1, dead: null },
  ...o,
}) as AgentView;

test("the soundtrack follows the mood: calm by day, uneasy at dusk, tense in danger or awake at night", () => {
  assert.equal(moodFor(view()), "calm");
  assert.equal(moodFor(view({ worldTime: 0.74 })), "uneasy");
  assert.equal(moodFor(view({ weather: "fog" })), "uneasy");
  assert.equal(moodFor(view({ worldTime: 0.95 })), "tense");
  assert.equal(moodFor(view({ worldTime: 0.95, sleeping: true })), "uneasy");
  assert.equal(moodFor(view({ health: 20 })), "tense");
  assert.equal(moodFor(view({ weather: "storm" })), "tense");
  assert.equal(moodFor(view({ feelings: { dread: 0.8 } })), "tense");
});
