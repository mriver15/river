// What River can come to know how to do, and what the world must hold for it to dawn on it. Nothing here is a goal: an ability is found by being in the
// situation it fits (a thought arrives), or by trying something and finding the way open (or finding what is missing). River is never shown this list.
// A few abilities stay with the human on purpose: reaching outside the island (the web) is never discovered.

export interface Situation {
  /** what is carried, by kind, with the capabilities of that kind */
  carried: { kind: string; qty: number; caps: string[] }[];
  /** near River (within a few paces) */
  near: { kind: string; species?: string; name: string; d: number }[];
  atShore: boolean; fishNear: boolean; hurt: boolean; threatened: boolean; visitorNear: boolean; fireNear: boolean; litFireNear: boolean; warmth: number; night: boolean;
}
/** How many of a kind (a def id) or of things with a capability are carried. */
export const have = (s: Situation, what: string): number => s.carried.reduce((n, c) => n + (c.kind === what || c.caps.includes(what) ? c.qty : 0), 0);
export const haveAny = (s: Situation, ...what: string[]): number => what.reduce((n, w) => n + have(s, w), 0);
export const kindsCarried = (s: Situation) => s.carried.filter((c) => c.qty > 0).length;
const animalNear = (s: Situation) => s.near.some((n) => n.kind === "animal" && n.species && !["firefly", "midges"].includes(n.species) && n.d < 6);

export interface Ability {
  /** the tool it opens */
  id: string;
  /** what River might say when it tries something like this */
  intent: RegExp;
  /** does the world allow it now? */
  when: (s: Situation) => boolean;
  /** if it can dawn from the situation alone, without being tried (true, or only in some situations) */
  spontaneous?: boolean | ((s: Situation) => boolean);
  /** tried, but not yet possible: what is missing, in the world's words (never the name of a tool) */
  lack: string;
  /** what River finds when it opens */
  dawn: string;
}

export const ABILITIES: Ability[] = [
  { id: "craft", intent: /\b(make|craft|join|lash|bind|tie|assemble|combine|fashion|shape|carve|sharpen|knap|fit together)\b/i,
    when: (s) => kindsCarried(s) >= 2 && s.carried.reduce((n, c) => n + c.qty, 0) >= 3, spontaneous: true,
    lack: "You turn what you have over in your hands, but there is too little of it, and too little that could go with anything else, to make something of.",
    dawn: "Turning the things over in your hands you begin to see how they might go together: a hard edge against a straight stick, a strip of bark pulled tight around both. You know how to make things." },
  { id: "build", intent: /\b(shelter|hut|lean-?to|house|roof|wall|fence|bench|tower|bridge|platform|cairn|raise|build)\b/i,
    when: (s) => haveAny(s, "stick", "plank", "stone", "bark", "moss", "clay") >= 6 && haveAny(s, "stick", "plank") >= 3, spontaneous: true,
    lack: "You look about for what would hold it up and keep the weather off, and you do not yet have enough that is long and strong, or enough to lay over it.",
    dawn: "With this much in your arms you can see how it would stand: stick leaned against stick, weight on weight, something laid over to keep off the wind. You know how to build." },
  { id: "clothe", intent: /\b(wear|clothes|clothing|cloak|tunic|wrap|garment|sew|stitch|weave|cover myself|keep warm|something warm)\b/i,
    when: (s) => haveAny(s, "fibre") >= 3, spontaneous: true,
    lack: "You pull at what you are carrying. There is not enough that bends and holds together to wrap around you.",
    dawn: "The bark bends, the moss holds together, the hide is warm against your arm. You see how they could be cut and joined to hang on a body. You know how to make clothes." },
  { id: "burn", intent: /\b(fire|burn|light a|ignite|kindle|spark|flame|campfire|warm myself)\b/i,
    when: (s) => (have(s, "stick") >= 1 && have(s, "stone") >= 1) || (s.fireNear && have(s, "stick") >= 1), spontaneous: (s) => s.warmth < 40 && have(s, "stick") >= 1 && have(s, "stone") >= 1,
    lack: "You look at what you have for something that would throw a spark, or catch one, and find nothing yet.",
    dawn: "Stone against stone, a dry stick beside them: you know how a spark could be struck, and how it could be fed. You know how to make fire." },
  { id: "fish", intent: /\b(fish|catch|angle|net|spear a fish|something to eat from the water)\b/i,
    when: (s) => s.atShore && s.fishNear, spontaneous: true,
    lack: "There is nothing in reach of the water to catch.",
    dawn: "The silver fish hang in the shallows, close enough to your hands, and the water does not hide them. You know how to try to catch one." },
  { id: "plant", intent: /\b(plant|sow|seed|garden|put (it|that) in the ground|grow)\b/i,
    when: (s) => have(s, "seed") >= 1, spontaneous: true,
    lack: "You have nothing that could grow.",
    dawn: "A seed in your palm is a whole tree folded very small. It could be put in the ground, and left. You know how to plant." },
  { id: "tend", intent: /\b(wound|bandage|heal|bleed|clean|dress|injur|hurt|tend|stop the bleeding)\b/i,
    when: (s) => s.hurt, spontaneous: true,
    lack: "You look yourself over and there is nothing that needs looking after.",
    dawn: "The wound is yours to look after: it could be washed in the salt water, and bound with something soft. You know how to tend your hurts." },
  { id: "defend", intent: /\b(fight|strike|hit|defend|weapon|spear|club|attack|fend|protect myself|hurt it back)\b/i,
    when: (s) => s.threatened || have(s, "pierces") >= 1, spontaneous: (s) => s.threatened,
    lack: "There is nothing here to fight, and nothing in your hands to fight with.",
    dawn: "You tighten your grip on what you hold. If it comes to it you could strike back, and a sharpened thing would strike harder. You know how to defend yourself." },
  { id: "colour", intent: /\b(colour|color|paint|dye|pigment|stain|draw|mark|grind|mix|decorate)\b/i,
    when: (s) => haveAny(s, "marks", "dyes", "berry", "flower", "mushroom", "chalk", "charcoal", "clay") >= 1, spontaneous: true,
    lack: "You have nothing that would leave its colour behind.",
    dawn: "The berry stains your fingers and will not rub off. Colour comes out of things, if they are crushed. You know how to work with colour." },
  { id: "name_creature", intent: /\b(name|call (it|him|her|them)|befriend|tame|the deer|the rabbit|the fox|the crow)\b/i,
    when: animalNear,
    lack: "There is no creature close enough to be someone to you.",
    dawn: "It looks at you; you look back. It seems like someone, and someone could be given a name that is theirs. You know how to name a creature." },
  { id: "offer", intent: /\b(feed|offer|share (food|my)|bait|coax|give .* (deer|rabbit|animal|fox|crow))\b/i,
    when: (s) => animalNear(s) && haveAny(s, "berry", "flower", "mushroom", "seed") >= 1, spontaneous: true,
    lack: "There is no creature near enough, or you have nothing you think it would take.",
    dawn: "It watches what is in your hand, not you. Some things are for giving. You know how to offer a creature something." },
  { id: "speak_to", intent: /\b(speak|talk|ask|greet|hail|call out|answer|hello)\b/i,
    when: (s) => s.visitorNear, spontaneous: true,
    lack: "There is no one here to speak to.",
    dawn: "A person, near enough to hear. You could say something to them and wait for the answer. You know how to speak to someone." },
  { id: "trade", intent: /\b(trade|barter|swap|exchange|bargain|buy|sell)\b/i,
    when: (s) => s.visitorNear && s.carried.some((c) => c.qty > 0),
    lack: "There is no one here to trade with, or you have nothing to trade.",
    dawn: "They carry things you do not, and you carry things they might want. What one has and the other wants could be passed across. You know how to trade." },
  { id: "name_place", intent: /\b(name (this|the) (place|spot)|call this place|mark this place|landmark|so i can find (it|this) again)\b/i,
    when: () => true,
    lack: "",
    dawn: "This spot is not like the others. It could have a name, so that you can find your way back to it. You know how to name a place." },
  { id: "compose", intent: /\b(sing|hum|music|song|melody|tune|play (a |the )?(flute|pipe)|compose|rhythm|drum|chime)\b/i,
    when: () => true,
    lack: "",
    dawn: "Your voice makes a note, and then a second, and they answer one another. There is more of this than one note. You know how to compose." },
];
export const abilityById = (id: string) => ABILITIES.find((a) => a.id === id);
/** Not discovered, ever: they reach beyond the island, so a human decides. */
export const HUMAN_ONLY = new Set(["web_search", "web_fetch"]);

const CAP_WORDS: Record<string, string> = {
  cuts: "has an edge that would cut", pierces: "comes to a point", binds: "is supple enough to tie with", shaft: "is long and straight", fibre: "could be worked into cord or cloth",
  "holds-liquid": "could hold water", holds: "could carry other things", burns: "would burn", fuel: "would burn", edible: "could be eaten", marks: "leaves a mark where it is drawn",
  dyes: "gives colour", moldable: "can be shaped when it is wet", insulates: "keeps the cold off", absorbs: "soaks things up", waterproof: "turns water", covers: "could be laid over something",
  wearable: "could be worn", sounds: "would sound if blown across", ore: "is heavy with something in it", hard: "is hard",
};
/** What a thing can do, in plain words about the thing (never the name of a tool). */
export function describeCapabilities(caps: string[]): string {
  const ph = [...new Set(caps.map((c) => CAP_WORDS[c]).filter((x): x is string => !!x))];
  if (!ph.length) return "It has no use beyond being what it is.";
  return `It ${ph.length > 1 ? `${ph.slice(0, -1).join(", ")} and ${ph.at(-1)}` : ph[0]}.`;
}
