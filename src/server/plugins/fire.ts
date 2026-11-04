// TEST_ARGS: {"action":"light","with":"stick","stone":"stone"}
import { log } from "../bus.ts";
import { ToolError, obj, str, num, type ToolDef, wait } from "../toolkit.ts";

const FUEL_MAX = 12;
const STICK_FUEL = 3;
const COOKABLE = new Set(["mushroom", "berry", "fish", "meat"]);
const isLit = (e: any) => !!e.props?.lit;
const fuelOf = (e: any) => Math.max(0, Math.round(Number(e.props?.fuel ?? 0)));

const fire: ToolDef = {
  name: "fire",
  description:
    "Build, feed, cook on, or put out one small campfire — a hearth you can come back to, read by, and draw a coal from. " +
    "Actions: `light` (needs a dry stick + a stone to strike it against, or a glowing coal), `tend` (feed it sticks for fuel), " +
    "`cook` (roasts mushrooms or berries, one fuel per item), `coal` (draws a carryable ember to light a fire elsewhere), " +
    "`douse` (smothers it dead). Fuel burns down with every use; a fire with no fuel is cold and must be relit. " +
    "It refuses to light within a few paces of anything growing.",
  input_schema: obj({
    action: { type: "string", enum: ["light", "tend", "cook", "coal", "douse"], description: "What to do with the fire." },
    with: str("light: what takes the spark — a dry stick, or a glowing coal. tend: what to feed it (defaults to a stick)."),
    stone: str("light with a stick: name of a stone in your inventory to strike against (defaults to something called 'stone')."),
    item: str("cook: the mushroom or berry in your inventory to roast."),
    qty: num("tend/cook: how many sticks to feed or items to roast (1-3, default 1)."),
  }, ["action"]),
  run: async (a, w) => {
    const action = String(a.action ?? "").toLowerCase();
    const qty = Math.max(1, Math.min(3, Math.round(Number(a.qty ?? 1)) || 1));
    const fireEnt: any = w.nearby(4).map((o) => o.e).find((e) => e.kind === "campfire");

    if (action === "light") {
      if (fireEnt && isLit(fireEnt)) throw new ToolError(`The fire (${fireEnt.id}) is already burning — tend it, cook on it, or draw a coal.`);
      if (!a.with) throw new ToolError("Say what takes the spark: a dry stick (you'll need a stone to strike it) or a glowing coal.");
      const main = w.findItem(String(a.with));
      if (!main) throw new ToolError(`You have nothing called "${a.with}". A dry stick or a glowing coal will work.`);
      const ember = /coal|ember/i.test(main.name);
      const kindling = !ember && (main.kind === "stick" || /stick/i.test(main.name)) ? main : null;
      if (!ember && !kindling) throw new ToolError(`${main.name} won't take a spark. Use a dry stick or a glowing coal.`);
      let striker: any = null;
      if (!ember) {
        striker = a.stone ? w.findItem(String(a.stone)) : w.findItem("stone");
        if (a.stone && !striker) throw new ToolError(`You have nothing called "${a.stone}".`);
        if (!striker || striker.id === main.id) throw new ToolError("You need a stone to strike the stick against — name one with `stone`, or light it from a glowing coal.");
      }
      let site = fireEnt, made = false;
      if (!site) {
        const risky = w.nearby(3).map((o) => o.e).find((e) => e.kind === "tree" || e.kind === "bush");
        if (risky) throw new ToolError(`A ${risky.name} stands within a few paces — one spark there and the island goes up. Step into the open and try again.`);
        const p = w.spotNearMe(1.2);
        site = w.spawn("campfire", "small fire", p.x, p.z, {});
        made = true;
      }
      w.setActivity(ember ? "coaxing an ember to flame" : "striking a spark");
      await wait(ember ? 3000 : 7000);
      w.bump({ energy: ember ? -2 : -7, mood: 6, curiosity: 2 });
      if (ember) w.takeItem(main.id, 1); else w.takeItem(kindling!.id, 1);
      const fuel = ember ? 2 : STICK_FUEL;
      const p = (site.props ??= {});
      p.lit = true; p.fuel = fuel; p.desc = "A small, tended fire in a ring of stones.";
      w.putEntity(site);
      log("world", "River lit a fire.", { fire: site.id });
      return `You ${ember ? "tip the coal into a nest of dry shavings and breathe on it until it catches" : "twist the stick between your palms against the stone notch until a thread of smoke curls up"} — the fire takes.` +
        ` It is small and steady, a fixed light: hold a glowcap against it, and against the dark on the far side, and you'll see what's really there.` +
        ` ${made ? "The ring of stones is new, yours to return to." : "The old ring wakes up again."} (${site.id}, fuel ${fuel}/${FUEL_MAX}.)`;
    }

    if (action === "tend") {
      if (!fireEnt) throw new ToolError("There's no fire within arm's reach to tend — light one first.");
      if (!isLit(fireEnt)) throw new ToolError(`The fire (${fireEnt.id}) is cold. Light it again first.`);
      const feed = a.with ? w.findItem(String(a.with)) : w.findItem("stick");
      if (!feed) throw new ToolError("You have nothing dry to feed it. Gather a stick first.");
      if (feed.kind !== "stick" && !/stick|twig|branch/i.test(feed.name)) throw new ToolError(`${feed.name} won't burn cleanly — a stick will.`);
      const cur = fuelOf(fireEnt);
      if (cur >= FUEL_MAX) throw new ToolError(`The fire (${fireEnt.id}) is already banked as high as it will safely go.`);
      const n = Math.min(qty, feed.qty);
      w.setActivity("feeding the fire");
      await wait(2000 + n * 600);
      w.takeItem(feed.id, n);
      const fuel = Math.min(FUEL_MAX, cur + n * STICK_FUEL);
      const p = (fireEnt.props ??= {});
      p.fuel = fuel; p.desc = "A small, tended fire in a ring of stones.";
      w.putEntity(fireEnt);
      w.bump({ energy: -1, mood: 3 });
      return `You feed ${n} stick${n > 1 ? "s" : ""} in, tips first. The flames take them and settle, warmer and more certain of themselves. (${fireEnt.id}, fuel ${fuel}/${FUEL_MAX}.)`;
    }

    if (action === "cook") {
      if (!fireEnt || !isLit(fireEnt)) throw new ToolError("You need a burning fire within reach to cook over.");
      if (!a.item) throw new ToolError('Say which mushroom or berry to roast, e.g. {"action":"cook","item":"mushroom"}.');
      const it = w.findItem(String(a.item));
      if (!it) throw new ToolError(`You have nothing called "${a.item}".`);
      if (it.props?.cooked || /^roasted/i.test(it.name)) throw new ToolError(`${it.name} is already cooked.`);
      if (!COOKABLE.has(it.kind)) throw new ToolError(`You can roast mushrooms, berries or fish over this flame — ${it.name} would only char.`);
      const n = Math.min(qty, it.qty), fuel = fuelOf(fireEnt);
      if (fuel < n) throw new ToolError(`The fire has ${fuel} fuel and needs ${n} to roast that. Feed it a stick first.`);
      w.setActivity("roasting over the fire");
      await wait(3000 + n * 800);
      const raw = it.id; w.takeItem(it.id, n);
      w.addItem(it.kind, `roasted ${it.name}`, `Hot from the fire: ${it.name}, softened and sweet, the rawness singed out of it.`, n, { cooked: true }, { sources: [raw], maker: true, condition: { temperatureC: 60 } });
      (fireEnt.props ??= {}).fuel = fuel - n;
      w.putEntity(fireEnt);
      w.bump({ energy: -1, mood: 4 });
      return `You turn ${n} ${it.name}${n > 1 ? "s" : ""} over the coals until the skin blisters and the smell of it makes your stomach speak up. Warm food, finally. (${fireEnt.id}, fuel ${fuel - n}/${FUEL_MAX}.)`;
    }

    if (action === "coal") {
      if (!fireEnt || !isLit(fireEnt)) throw new ToolError("You need a burning fire to draw a coal from.");
      const fuel = fuelOf(fireEnt);
      if (fuel < 3) throw new ToolError(`The fire has only ${fuel} fuel — it can't spare an ember. Feed it a stick or two first.`);
      w.setActivity("drawing an ember");
      await wait(2500);
      (fireEnt.props ??= {}).fuel = fuel - 2;
      w.putEntity(fireEnt);
      w.addItem("crafted", "glowing coal", "An ember from River's fire, nested in a curl of bark. It glows steadily and will light a new fire without a stone.", 1, { coal: true }, { maker: true, condition: { temperatureC: 120 }, note: "an ember drawn from a fire" });
      w.bump({ energy: -1, curiosity: 2 });
      return `You coax a coal out onto a curl of bark and cup it. It glows stubborn and orange in your hands — carry it carefully and it will light a hearth wherever you stop. (${fireEnt.id}, fuel ${fuel - 2}/${FUEL_MAX}.)`;
    }

    if (action === "douse") {
      if (!fireEnt) throw new ToolError("There's no fire here to put out.");
      if (!isLit(fireEnt)) throw new ToolError(`The fire (${fireEnt.id}) is already out.`);
      w.setActivity("smothering the fire");
      await wait(2500);
      const p = (fireEnt.props ??= {});
      p.lit = false; p.fuel = 0; p.desc = "A cold ring of stones with grey ash in the middle — a hearth waiting to be relit.";
      w.putEntity(fireEnt);
      w.bump({ energy: -2 });
      return `You smother it with sand, handful by handful, until the last coal goes from orange to grey and the hiss stops. The stone ring stays as a marker. Nothing on the island is burning now. (${fireEnt.id})`;
    }

    throw new ToolError(`Unknown action "${a.action}". Use light, tend, cook, coal, or douse.`);
  },
};
export default fire;
