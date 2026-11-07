// "Old Hands": traces of how things are done, left by someone who was here before: a page of notes, a scratched drawing, a handprint. They describe a way of doing
// something in the voice of whoever left them. They are found, not given: River may read them, ignore them, or try what they say.
import { simNow } from "../sim.ts";
import { isLand } from "../../shared/noise.ts";
import type { Pack } from "./index.ts";

const HOUR = 3_600_000;
const spot = (c: { w: any; rand: (a: number, b: number) => number }, near: { x: number; z: number }, spread: number) => {
  for (let i = 0; i < 100; i++) { const x = near.x + c.rand(-spread, spread), z = near.z + c.rand(-spread, spread); if (isLand(x, z, c.w.seed) && Math.hypot(x - near.x, z - near.z) > 5) return { x, z }; }
  return null;
};
/** A page left lying about: a book River can pick up and read. */
const page = (title: string, text: string, desc: string, say: (c: any, p: { x: number; z: number }) => string) => (c: any) => {
  const p = spot(c, c.w.me, 30); if (!p) return;
  c.w.spawn("book", `book: ${title}`, p.x, p.z, { takeable: true, item: "book", desc, text, title, topic: "craft", expires: simNow() + 6 * HOUR });
  c.say(say(c, p), p, 30);
};

export const hands: Pack = {
  id: "hands",
  title: "Old Hands",
  inspiration: ["the castaway's notebook: Crusoe's journal, a stranded sailor's list of what worked", "field guides to bushcraft, written in the plain voice of someone who learned it by failing", "cave paintings: how-to as a picture, the oldest instruction there is", "Hatchet: a book of someone else's solved problems found in the wreck"],
  events: [
    { name: "page-lashing", weight: 2, tone: "calm", theme: "message",
      run: page("Notes on Tying", "Two sticks will not stay together by being wished. A strip of bark, wet so that it will bend, pulled tight three times round and tucked under itself, will hold a roof up. Dry bark cracks. Wet bark remembers.", "A few damp pages folded over, the ink run in places. The first line is about knots.", () => "A few pages lie in the grass, folded over, as if dropped.") },
    { name: "page-fire", weight: 2, tone: "calm", theme: "message",
      run: page("A Small Fire", "Dry moss, a handful, in a nest of fine sticks. A flat stone to strike on, a harder one to strike with, close to the nest and low. The spark is small and does not last. Blow on it as you would on soup.", "A single leaf of paper, scorched at one edge, written very small.", () => "A scorched leaf of paper has caught against a root.") },
    { name: "scratched-fish", weight: 2, tone: "mystery", theme: "trace",
      run: (c) => {
        const rocks = [...c.w.entities.values()].filter((e: any) => e.kind === "rock" && !e.props.drawn && Math.hypot(e.x - c.w.me.x, e.z - c.w.me.z) < 60);
        if (!rocks.length) return;
        const r = rocks[Math.floor(c.rand(0, rocks.length))]; r.props.drawn = true;
        r.props.desc += " A figure is scratched into the face: a hand held flat above wavy lines, and under it, small fish, all turned toward the hand.";
        c.w.putEntity(r); c.say(`There is a drawing scratched into the ${r.name}, old and shallow: a hand, still, over water, and fish.`, r, 20);
      } },
    { name: "seed-leaf", weight: 2, tone: "calm", theme: "growth",
      run: (c) => {
        const p = spot(c, c.w.me, 25); if (!p) return;
        c.w.spawn("trace", "folded leaf", p.x, p.z, { desc: "A large leaf, folded into a packet and tied with a thread of grass. Inside are three dry seeds, and scratched on the inside of the leaf, a small picture of a hole, a seed in it, and a line of drops.", expires: simNow() + 3 * HOUR });
        c.say("Something folded and green lies on the path, tied with grass.", p, 25);
      } },
    { name: "red-handprint", weight: 2, tone: "mystery", theme: "trace",
      run: (c) => {
        const rocks = [...c.w.entities.values()].filter((e: any) => e.kind === "rock" && !e.props.printed && Math.hypot(e.x - c.w.me.x, e.z - c.w.me.z) < 60);
        if (!rocks.length) return;
        const r = rocks[Math.floor(c.rand(0, rocks.length))]; r.props.printed = true;
        r.props.desc += " On one face is a small red handprint, fingers spread. Beside it, a stain of the same red, as if from a crushed berry, has dried to a crust.";
        c.w.putEntity(r); c.say(`A small red handprint is pressed into the ${r.name}, the colour of crushed berries.`, r, 20);
      } },
  ],
  books: [
    ["The Castaway's Notebook", "craft", "What worked, in order: water, then fire, then a roof, then something to eat that is not berries. Everything after that is a luxury, and everything before it is why you are still reading."],
    ["On Making Things Stay", "craft", "A thing that is made is only a few things that have agreed to stay together. Bark, wet. Root, split. Clay, pressed and fired. Weight, laid on weight. The agreement is the whole of the craft."],
  ],
};
