import test from "node:test";
import assert from "node:assert/strict";
import { step, initial, MODEL, BASE, present, shown, type Pops } from "../src/sim/ecology.ts";
import { seasonAt, RULES } from "../src/sim/seasons.ts";

const HOURS_PER_DAY = 24;
function run(p: Pops, days: number, seasonDays = 6, food = (id: string) => 0.7, hunted: (h: number) => Record<string, number> = () => ({} as Record<string, number>)): Pops[] {
  const out: Pops[] = [];
  for (let h = 0; h < days * HOURS_PER_DAY; h++) {
    const s = seasonAt(Math.floor(h / HOURS_PER_DAY) + 1, seasonDays), lean = s.id === "winter" ? 0.25 : s.id === "autumn" ? 0.5 : 0.8;
    p = step(p, { food: lean * 0.9 + 0.1 * food(""), growth: RULES[s.id].growth });
    for (const [k, n] of Object.entries(hunted(h))) p[k] = Math.max(0, (p[k] ?? 0) - n);
    out.push(p);
  }
  return out;
}

test("left alone, the island keeps all four kinds through many years, never negative, never over what it can hold", () => {
  const h = run(initial(), 6 * 4 * 8);
  for (const p of h) for (const [k, m] of Object.entries(MODEL)) { assert.ok(p[k]! >= 0 && p[k]! <= m.cap + 1e-9, `${k} ${p[k]}`); }
  const last = h.slice(-HOURS_PER_DAY * 24);                                            // the final year
  for (const k of Object.keys(MODEL)) assert.ok(Math.max(...last.map((p) => p[k]!)) > 0.8, `${k} survives: peaked at ${Math.max(...last.map((p) => p[k]!)).toFixed(2)}`);
});

test("winter thins the grazers and spring brings them back", () => {
  const h = run(initial(), 6 * 4 * 10), mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const of = (season: number) => mean(h.flatMap((p, i) => (Math.floor(i / HOURS_PER_DAY / 6) % 4 === season && i > 6 * 4 * 3 * HOURS_PER_DAY ? [p.rabbit!] : [])));
  assert.ok(of(3) < of(1) - 0.5, `rabbits: winter ${of(3).toFixed(2)} against summer ${of(1).toFixed(2)}`);
});

test("hunting the deer hard costs the wolves, who go hungry, and the deer return slowly", () => {
  const base = run(initial(), 6 * 4 * 2);
  const shot = run({ ...base.at(-1)! }, 6 * 4 * 3, 6, () => 0.7, (h): Record<string, number> => (h === 0 ? { deer: 99 } : {}));      // every deer taken at once
  assert.ok(shot[0]!.deer! < 0.2);
  const wolvesLow = Math.min(...shot.map((p) => p.wolf!)), wolvesAtStart = base.at(-1)!.wolf!;
  assert.ok(wolvesLow < wolvesAtStart, `the wolves fall (${wolvesAtStart.toFixed(2)} → ${wolvesLow.toFixed(2)})`);
  assert.ok(shot.at(-1)!.deer! > 1, `the deer come back over time (${shot.at(-1)!.deer!.toFixed(2)})`);
  assert.ok(shot[HOURS_PER_DAY]!.deer! < base.at(-1)!.deer! * 0.8, "but not at once");
});

test("the world shows whole animals, some are simply absent in some seasons, and kinds outside the model are left as they are", () => {
  assert.equal(shown({ deer: 2.6 }, "deer", 3), 3); assert.equal(shown({ deer: 0.4 }, "deer", 3), 0); assert.equal(shown({}, "gull", 3), 3);
  assert.equal(present("bear", "winter"), false); assert.equal(present("bear", "summer"), true); assert.equal(present("songbird", "winter"), false);
  assert.deepEqual(initial(), BASE);
});
