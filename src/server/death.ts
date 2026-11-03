// When River dies it stays dead until a human begins a new life. The island keeps what is left: a grave with the facts of that
// life written on it, and whatever River was carrying, scattered where it fell. The next River is born bare and blank, and
// may find the grave. Nothing else carries over.
import { bus, log } from "./bus.ts";
import { db } from "./db.ts";
import { addMemory } from "./memory.ts";
import { works } from "./taste.ts";
import { worn } from "./clothing.ts";
import type { World } from "./world.ts";
import type { Agent } from "./agent.ts";
import { simRng } from "./sim.ts";
import { beginGeneration } from "./lifecycle.ts";
const sr = simRng("death");

export function setupDeath(w: World, agent: Agent) {
  bus.on("died", (d: { cause: string; born: number; at: number; x: number; z: number }) => {
    beginGeneration();                                     // anything still in flight for this life is now stale
    const days = (d.at - d.born) / (24 * 60_000), name = w.me.name;
    const held = [...w.inventory.values()].map((i) => `${i.qty} ${i.name}`), made = works(6).map((x) => x.name), wearing = worn().map((g) => g.name);
    const t = w.worldTime(), when = t < 0.23 || t > 0.78 ? "in the night" : "by day";
    const lit = [...w.entities.values()].some((e) => e.kind === "campfire" && e.props.lit !== false && Math.hypot(e.x - d.x, e.z - d.z) < 10);
    const text = [`Here lies ${name}, who lived ${days < 1 ? "less than a day" : `${days.toFixed(1)} days`} and died ${when}. ${d.cause[0].toUpperCase()}${d.cause.slice(1)} was the end of them.`,
      wearing.length ? `They wore ${wearing.join(", ")}.` : "They died with nothing on.", held.length ? `They carried ${held.join(", ")}.` : "They carried nothing.",
      lit ? "A fire was burning nearby." : "There was no fire.", made.length ? `They had made ${made.join(", ")}.` : "They had made nothing."].join(" ");
    db.prepare("INSERT INTO lives(name,born,died,days,cause,x,z,summary) VALUES(?,?,?,?,?,?,?,?)").run(name, d.born, d.at, days, d.cause, d.x, d.z, text);
    w.spawn("grave", `grave of ${name}`, d.x, d.z, { desc: `A low mound of earth under a flat stone. Something is scratched on the stone.`, text });
    let n = 0;                                                                     // what it carried lies where it fell
    for (const i of w.inventory.values()) for (let k = 0; k < Math.min(i.qty, 3) && n < 12; k++, n++) {
      const a = sr() * 6.28, r = 1.2 + sr() * 1.6;
      w.spawn("item", i.name, d.x + Math.cos(a) * r, d.z + Math.sin(a) * r, { takeable: true, item: i.kind, itemName: i.name, desc: i.desc });
    }
    log("world", `${name} died: ${d.cause}.`, { perceived: false });
    addMemory(`${name} died: ${d.cause}.`, 10, ["death"]);
    agent.setPaused(true, true); bus.emit("state");
  });
}
