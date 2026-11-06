// "The Mind": ordinary perception turned a little wrong, after well-known psychological effects and the stories built on them: deja vu, the doppelganger,
// pareidolia, the Zeigarnik effect, the Mandela effect, the uncanny valley, the Truman Show. These describe what River experiences; they never claim anything is true.
import { simNow } from "../sim.ts";
import { isLand } from "../../shared/noise.ts";
import type { Pack } from "./index.ts";

const HOUR = 3_600_000;
const near = (c: { w: any; rand: (a: number, b: number) => number }, r: number) => {
  for (let i = 0; i < 100; i++) {
    const x = c.w.me.x + c.rand(-r, r), z = c.w.me.z + c.rand(-r, r);
    if (isLand(x, z, c.w.seed) && Math.hypot(x - c.w.me.x, z - c.w.me.z) > 4) return { x, z };
  }
  return null;
};

export const mind: Pack = {
  id: "mind",
  title: "The Mind",
  inspiration: ["deja vu (and the Dark and Twin Peaks way of using it)", "the doppelganger: Dostoevsky, Fight Club, Us", "pareidolia: faces in clouds, rock and weed", "the Zeigarnik effect: unfinished things stay in mind", "the Mandela effect: a confident memory that is wrong", "the uncanny valley: almost-right is worse than wrong", "The Truman Show: a world that is slightly staged"],
  events: [
    {
      name: "deja-vu", weight: 2, tone: "mystery", theme: "self",
      run: (c) => c.say("You stop. This exact spot, this exact stillness, the sound just now: you have been here before, in this order. You have not."),
    },
    {
      name: "own-tracks", weight: 2, tone: "tension", theme: "trace",
      run: (c) => {
        const p = near(c, 14); if (!p) return;
        c.w.spawn("trace", "your own footprints", p.x, p.z, { desc: "Bare footprints, exactly the size and stride of yours, the left a little deeper than the right, as yours is. They are walking away from you. The soil in them is still damp.", expires: simNow() + 0.75 * HOUR });
        c.say("There are footprints here, and they are the shape of your feet.", p, 18);
      },
    },
    {
      name: "faces-in-things", weight: 3, tone: "mystery", theme: "self",
      run: (c) => {
        const rocks = [...c.w.entities.values()].filter((e) => (e.kind === "rock" || e.kind === "tree") && Math.hypot(e.x - c.w.me.x, e.z - c.w.me.z) < 25 && !e.props.faced);
        if (!rocks.length) return c.say("In the grain of the nearest bark, two knots and a split make a face, and for a moment it is looking back.");
        const r = rocks[Math.floor(c.rand(0, rocks.length))]; r.props.faced = true;
        r.props.desc += " Two hollows and a crack, in just the places where a face would have them.";
        c.w.putEntity(r); c.say(`The ${r.name} is looking at you. It has two hollows and a crack in the right places, and you cannot stop seeing it.`, r, 20);
      },
    },
    {
      name: "unfinished-cairn", weight: 2, tone: "mystery", theme: "trace",
      run: (c) => {
        const p = near(c, 20); if (!p) return;
        c.w.spawn("trace", "unfinished cairn", p.x, p.z, { desc: "Five flat stones stacked with great care, each smaller than the one below. The sixth stone lies on the ground beside it, as if set down a moment ago.", expires: simNow() + 2 * HOUR });
        c.say("Someone has been stacking stones here, and stopped.", p, 22);
      },
    },
    {
      name: "one-step-fewer", weight: 1, tone: "mystery", theme: "self",
      when: (c) => [...c.w.entities.values()].some((e) => e.kind === "shrine" || e.kind === "library"),
      run: (c) => {
        const e = [...c.w.entities.values()].find((x) => x.kind === "shrine" || x.kind === "library");
        if (!e) return;
        c.say(`You were certain the ${e.name} had one more step up to it. You count them. It has the number it has, and you are no longer certain of anything else about it.`, e, 60);
      },
    },
    {
      name: "too-still", weight: 2, tone: "tension", theme: "animals",
      when: (c) => !c.night,
      run: (c) => c.say("At the edge of the trees a deer is standing with its head turned all the way round, looking at you. When you blink, it is grazing, head down, as if it had never moved."),
    },
    {
      name: "painted-sky", weight: 1, tone: "spectacle", theme: "light",
      run: (c) => c.say("For a moment, at the horizon, the sky looks flat, with a faint seam where two panels do not quite meet. Then it is only the sea and the evening."),
    },
    {
      name: "late-echo", weight: 2, tone: "tension", theme: "sound",
      when: (c) => c.night,
      run: (c) => c.say("An owl calls, and the call comes back a half-beat late, from the wrong side, in a voice that is not quite an owl's."),
    },
  ],
  books: [
    ["On Recognising Faces", "faces", "The mind will find a face in anything with two marks and a line. It is less a mistake than a habit of kindness, or of fear."],
    ["The Unfinished", "memory", "A task interrupted is remembered twice as well as one completed. The mind keeps the open door in view."],
    ["Doubles", "self", "Every account of the double agrees on one thing: it is met when the self is tired, at a place already known, and it does not speak first."],
  ],
};
