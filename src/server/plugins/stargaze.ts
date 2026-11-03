// TEST_ARGS: {"landmark":"monolith","minutes":10}
import { ToolError, obj, num, str, type ToolDef, rand, wait } from "../toolkit.ts";

const STARS = [
  { name: "the Lantern", d: "amber, unwavering" },
  { name: "the Third Lantern", d: "small and low, red as a coal" },
  { name: "the Plough", d: "four cold points and a long handle" },
  { name: "the Drift", d: "a smear of pale dust" },
  { name: "the Hunter", d: "three in a belt, bright and level" },
  { name: "the Shell", d: "a spiral of faint pinpricks" },
  { name: "the Wound", d: "dark, ringed with stars that avoid it" },
];

const stargaze: ToolDef = {
  name: "stargaze",
  description:
    "Tip your head back and study the night sky: the stars, how bright they are, and where they sit relative to a landmark (monolith, shrine, tree, campfire...). Needs night, clear weather overhead, and enough energy to stay upright. Cheap; a few minutes of standing.",
  input_schema: obj({
    landmark: str("Name or id of a nearby landmark to measure the sky against. Optional."),
    minutes: num("How long to watch, 2-30. Longer reveals more and costs more energy (default 10)."),
  }),
  run: async (a, w) => {
    const min = Math.max(2, Math.min(30, Number(a.minutes ?? 10)));
    if (w.me.sleeping) throw new ToolError("You're asleep. Wake first.");
    if (w.me.needs.energy < 8) throw new ToolError("You're too tired to keep your head back; you'd just nod off. Rest first.");

    // Night check: rely on the world's own label.
    const t = String(w.timeLabel()).toLowerCase();
    const night = /night|dark|midnight|evening|dusk|small hours/.test(t);
    if (!night) throw new ToolError(`It's ${w.timeLabel()} — the sky is too bright to see stars. Come back after dark.`);

    let ref = null as any;
    if (a.landmark) {
      const key = String(a.landmark).toLowerCase();
      ref = w.nearby(40).map((o) => o.e).find(
        (e) => e.id === key || e.name.toLowerCase() === key || e.name.toLowerCase().includes(key),
      );
      if (!ref) throw new ToolError(`No landmark called "${a.landmark}" within sight (40m). Try monolith, shrine, or a tree you're standing by.`);
    }

    w.setActivity("stargazing");
    await wait(Math.min(9000, 900 + min * 300));
    w.bump({ energy: -Math.ceil(min / 6), curiosity: -Math.min(20, 4 + min / 2), mood: 4 });

    // Visible stars scale with time watched.
    const count = Math.max(2, Math.min(STARS.length, Math.round(min / 4)));
    const picked = STARS.slice(0, count);
    const lines: string[] = [`It's ${w.timeLabel()}. You tip your head back.`];

    if (ref) {
      const c = w.compass(ref);
      const d = w.dist(ref);
      lines.push(`You set the ${ref.name} at your ${c} shoulder, or thereabouts — it stands ${d.toFixed(0)}m off, dark against the dark. Measured against it:`);
    } else {
      lines.push("With no landmark chosen, you fix the sky to your own feet and guess the bearings:");
    }

    const bearings = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
    for (const s of picked) {
      const bearing = bearings[Math.floor(rand() * bearings.length)];
      const height = 15 + Math.floor(rand() * 60);
      lines.push(`— ${s.name}, ${s.d}, ${bearing} and ${height}° above the horizon.`);
    }

    if (min >= 8 && rand() < 0.6) {
      const s = picked[0];
      lines.push(`After a while you notice ${s.name} has moved a hand's width. Time is passing up there, same as down here.`);
    }
    if (min >= 16) lines.push("The whole field of stars has shifted; you could almost read a season off it. Your neck aches.");
    if (min < 6) lines.push("You look too briefly to fix anything in memory — just glints, gone.");

    return lines.join("\n");
  },
};

export default stargaze;
