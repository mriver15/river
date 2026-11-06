// "The Zone": places and objects that do not belong, in the manner of Stalker, Lost, Annihilation, the Backrooms and Cast Away.
// Nothing here explains itself.
import { simNow } from "../sim.ts";
import { isLand } from "../../shared/noise.ts";
import type { Pack } from "./index.ts";

const HOUR = 3_600_000;
const open = (c: { w: any; rand: (a: number, b: number) => number }, near?: { x: number; z: number }, spread = 40) => {
  for (let i = 0; i < 200; i++) {
    const x = (near?.x ?? 0) + c.rand(-spread, spread), z = (near?.z ?? 0) + c.rand(-spread, spread);
    if (isLand(x, z, c.w.seed)) return { x, z };
  }
  return null;
};

export const zone: Pack = {
  id: "zone",
  title: "The Zone",
  inspiration: ["Stalker (1979): a place that rearranges itself and is never explained", "Lost: a hatch, a number sequence, a signal", "Annihilation: growth that is wrong in a regular way", "the Backrooms and liminal spaces: a threshold with nothing on either side", "Cast Away: a face seen in an object, and a company made of it"],
  events: [
    {
      name: "hatch", weight: 1, tone: "mystery", theme: "pattern",
      run: (c) => {
        const p = open(c, c.w.me, 55); if (!p) return;
        const seq = c.pick(["1 2 3 5 8 13", "2 3 5 7 11 13", "1 2 4 8 16 32", "4 8 15 16 23 42"]);
        c.w.spawn("trace", "iron hatch", p.x, p.z, { desc: `A round iron hatch set flush in the ground, rusted at the rim, the lid warm to the touch. Stamped into it in a ring: ${seq}. It does not open.`, expires: simNow() + 3 * HOUR });
        c.say("Where the grass was thin, a circle of rusted iron is showing through the soil.", p, 40);
      },
    },
    {
      name: "float-face", weight: 2, tone: "calm", theme: "material",
      run: (c) => {
        const p = open(c, { x: 0, z: 0 }, 70); if (!p) return;
        c.w.spawn("item", "cork float", p.x, p.z, { takeable: true, item: "generic", itemName: "cork float", desc: "A round cork float from a fishing net, the size of a head. A smudged red handprint on one side looks, if you tilt your head a little, like a face.", expires: simNow() + 4 * HOUR });
        c.say("Something round and pale has come ashore with the weed.", p, 45);
      },
    },
    {
      name: "doorframe", weight: 1, tone: "mystery", theme: "place",
      run: (c) => {
        const p = open(c, c.w.me, 35); if (!p) return;
        c.w.spawn("trace", "doorframe", p.x, p.z, { desc: "A doorframe of grey, weathered wood stands alone in the open grass, closed in nothing. Through it you see the same grass, the same sky, from slightly too far away.", expires: simNow() + 2 * HOUR });
        c.say("A doorframe stands in the grass where there was only grass.", p, 30);
      },
    },
    {
      name: "path-moved", weight: 1, tone: "mystery", theme: "place",
      when: (c) => c.w.me.x * c.w.me.x + c.w.me.z * c.w.me.z > 100,
      run: (c) => c.say("The way you walked here is not quite the way you remember it. The same trees, in a different order."),
    },
    {
      name: "wrong-growth", weight: 1, tone: "mystery", theme: "growth",
      when: (c) => !c.night,
      run: (c) => {
        const p = open(c, c.w.me, 30); if (!p) return;
        c.w.spawn("trace", "ring of ferns", p.x, p.z, { desc: "Ferns growing in a perfect ring, every frond bent the same way, as if something turned them all together. The ground inside is bare and cool.", expires: simNow() + 2 * HOUR });
        c.say("Ferns in the shade here have grown in a ring, and every one leans the same way.", p, 25);
      },
    },
    {
      name: "the-signal", weight: 1, tone: "mystery", theme: "sound",
      when: (c) => c.night,
      run: (c) => c.say("From somewhere under the ground comes a short run of sound, three long and two short, repeated. Then it stops mid-pattern, as if whoever was sending it heard you listening."),
    },
  ],
  books: [
    ["A Field Guide to Places That Move", "places", "Surveyors report that the thing which moves is not the place but the observer. A place that cannot be mapped twice is still, patiently, one place."],
    ["Hatches and Other Closed Things", "doors", "Every door implies a room. The reverse has never been shown."],
  ],
};
