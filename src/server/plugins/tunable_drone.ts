// TEST_ARGS: {"action":"build","bow":"stick","box":"shell"}
import { log } from "../bus.ts";
import { ToolError, obj, str, num, type ToolDef } from "../toolkit.ts";

const OPEN = 196.0; // the open string: mark 0, fixed for good
const GRID = 10;    // cents between scratched marks
const cents = (hz: number) => 1200 * Math.log2(hz / OPEN);
const hzOf = (c: number) => OPEN * Math.pow(2, c / 1200);
const findDrone = (w: any) => w.nearby(5).map((o: any) => o.e).find((e: any) => e.kind === "item" && e.props?.drone);

const drone: ToolDef = {
  name: "tunable_drone",
  description:
    "Build a monochord you set on the ground (a shell soundbox, a string, a sliding weight, marks ten cents apart) and use it to measure any other tone by beats. " +
    "'build' needs a stick to bow with and a shell for the box; a stone as weight keeps it steady, without one it drifts. " +
    "Then 'slide' the pitch by some cents, 'hold' to bow one long note, and 'beats' to turn a counted beat-rate into a frequency and a cents offset.",
  input_schema: obj({
    action: str("build | slide | hold | beats"),
    bow: str("build: item to bow with (a stick)."),
    box: str("build: item for the soundbox (a shell)."),
    weight: str("build: optional stone to tension the string; without it the drone creeps."),
    cents: num("slide: cents to raise (+) or lower (-), up to 120."),
    wedge: str("slide: optional seed to jam the weight, giving one-cent resolution."),
    seconds: num("hold: bow for 3-20 seconds. beats: how long you counted over."),
    beats: num("beats: beats counted between the drone and the other tone."),
    direction: str("beats: 'higher' if the other tone was above the drone, 'lower' if below."),
  }, ["action"]),
  run: async (a, w) => {
    const act = String(a.action ?? "").toLowerCase().trim();

    if (act === "build") {
      if (!a.bow || !a.box) throw new ToolError("Name your materials: a stick to bow with (bow) and a hollow shell for the box (box).");
      const bow = w.findItem(String(a.bow));
      if (!bow) throw new ToolError(`You aren't carrying "${a.bow}".`);
      if (bow.kind !== "stick") throw new ToolError(`${bow.name} won't flex into a bow. A stick would.`);
      const box = w.findItem(String(a.box));
      if (!box) throw new ToolError(`You aren't carrying "${a.box}".`);
      if (box.kind !== "shell") throw new ToolError(`${box.name} won't ring. You need something hollow, like a shell, to carry the note.`);
      let weight = null;
      if (a.weight) {
        weight = w.findItem(String(a.weight));
        if (!weight) throw new ToolError(`You aren't carrying "${a.weight}".`);
        if (weight.kind !== "stone") throw new ToolError(`${weight.name} is too light to hold tension. A stone would do.`);
      }
      if (findDrone(w)) throw new ToolError("A drone already stands within reach. Tune that one — one is enough to listen to.");
      w.setActivity("building a drone");
      await new Promise((r) => setTimeout(r, 8000));
      w.takeItem(box.id, 1);
      if (weight) w.takeItem(weight.id, 1);
      w.bump({ energy: -7, mood: 4, curiosity: 3 });
      const s = w.spotNearMe(1.2);
      const e = w.spawn("item", "tunable drone", s.x, s.z, {
        drone: true, hz: OPEN, mark: 0, weighted: !!weight, wedge: false,
        desc: "A monochord: a shell soundbox with a gut string stretched over its mouth and marks scratched along the string ten cents apart.",
      });
      log("world", "River set a tunable drone on the ground.", { drone: e.id });
      return `You bed the ${box.name} against the earth, stretch the string over its mouth and bow with the ${bow.name}. It locks onto one long note: ${OPEN.toFixed(1)} vibrations a second, scratched as mark 0.\n` +
        (weight ? `The ${weight.name} hangs at the far end; it slides along the marks as you push it.`
          : `Nnothing weights the far end — the string sags and creeps.`) +
        `\nSlide it in cents, bow it with 'hold', and count beats against your flute.`;
    }

    const found = findDrone(w);
    if (!found) throw new ToolError("Your drone isn't within reach. Go and stand beside it.");
    const d: any = found.props;

    if (act === "slide") {
      const delta = Number(a.cents);
      if (!Number.isFinite(delta) || delta === 0) throw new ToolError("Say how far to slide the weight, in cents: a non-zero number, up to 120 either way.");
      if (Math.abs(delta) > 120) throw new ToolError("One push only moves 120 cents. Slide, bow, slide again.");
      const from = cents(d.hz);
      if (from + delta < -500 || from + delta > 500) throw new ToolError(`The marks run out there — the string spans 500 cents either side of open, and sits at ${from.toFixed(0)}.`);
      let wedge = null;
      if (a.wedge) {
        if (d.wedge) throw new ToolError("The weight is already jammed with a seed.");
        wedge = w.findItem(String(a.wedge));
        if (!wedge) throw new ToolError(`You aren't carrying "${a.wedge}".`);
        if (wedge.kind !== "seed") throw new ToolError(`${wedge.name} won't jam anything. A seed would.`);
      }
      w.setActivity("sliding the drone's weight");
      await new Promise((r) => setTimeout(r, Math.min(2000 + Math.abs(delta) * 25, 7000)));
      w.bump({ energy: -2 });
      let target = from + delta;
      if (d.wedge || wedge) target = Math.round(target);
      else target = Math.round(target / GRID) * GRID;
      if (wedge) { w.takeItem(wedge.id, 1); d.wedge = true; }
      const slip = d.weighted ? 0 : 2 * (0.3 + Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      d.mark = target + slip; d.hz = hzOf(d.mark); w.putEntity(found);
      return `You ${delta > 0 ? "ease" : "draw"} the weight along the string, bowing as it settles. It stops at ${d.mark.toFixed(0)} cents above open — ${d.hz.toFixed(2)} vibrations a second.\n` +
        (d.wedge ? "The seed jams it: a cent at a time now." : "It sits on a mark; between marks it slides back. A seed jammed under it would hold finer than ten cents.") +
        (Math.abs(slip) > 0.2 ? ` It creeps ${Math.abs(slip).toFixed(1)} cents as you lift your hand.` : "");
    }

    if (act === "hold") {
      const secs = Math.max(3, Math.min(20, Number(a.seconds) || 8));
      w.setActivity("bowing the drone");
      await new Promise((r) => setTimeout(r, Math.min(Math.round(secs * 400), 9000)));
      w.bump({ energy: -Math.round(2 + secs / 4), mood: 3, curiosity: 1 });
      const drift = ((d.weighted ? 0.8 : 3.5) + (d.wedge ? 0.5 : 0)) * (secs / 8) * (0.4 + Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      d.mark = cents(d.hz) + drift; d.hz = hzOf(d.mark); w.putEntity(found);
      return `You bow for ${secs} seconds and the string gives one unbroken note: ${d.hz.toFixed(2)} vibrations a second, mark ${d.mark.toFixed(0)}.\n` +
        `Set your flute against it and the two will beat. Count the beats over a known stretch and hand the count to 'beats'. ` +
        `When you stop, the string has crept ${Math.abs(drift).toFixed(1)} cents ${drift > 0 ? "sharp" : "flat"} as it warmed.`;
    }

    if (act === "beats") {
      const beats = Number(a.beats), secs = Number(a.seconds);
      const dir = String(a.direction ?? "").toLowerCase();
      if (!Number.isFinite(beats) || beats <= 0 || beats > 300) throw new ToolError("Give the beat count you heard: a positive number, no more than 300.");
      if (!Number.isFinite(secs) || secs <= 0 || secs > 120) throw new ToolError("Give how many seconds you counted over: a positive number, no more than 120.");
      if (dir !== "higher" && dir !== "lower") throw new ToolError("Say whether the other tone sat 'higher' or 'lower' than the drone.");
      const rate = beats / secs;
      const fdrone = d.hz;
      const other = dir === "higher" ? fdrone + rate : fdrone - rate;
      const off = 1200 * Math.log2(other / fdrone);
      w.bump({ curiosity: -4, mood: 2 });
      return `${beats} beats in ${secs} seconds is ${rate.toFixed(2)} per second — that is the gap between the strings: ${rate.toFixed(2)} vibrations a second.\n` +
        `The drone sits at ${fdrone.toFixed(2)}; so the other tone is ${other.toFixed(2)} vibrations a second, ${Math.abs(off).toFixed(1)} cents ${dir === "higher" ? "sharp" : "flat"} of the drone (mark ${(cents(d.hz) + off).toFixed(0)} if you slide to match it).\n` +
        `Count again over a longer stretch before you trust it: one beat of miscount shifts the answer by a whole cent.`;
    }

    throw new ToolError("Unknown action. Use build, slide, hold or beats.");
  },
};
export default drone;
