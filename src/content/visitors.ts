// Who comes ashore. Each archetype is a way of being a stranger, drawn from stories. They bring their own wants and goods, speak in their own voice and
// never explain the island or hand River a goal: a visitor is someone to meet, not a quest. `lines` are what they say with no model; `persona` is what a
// model is told when it gives them a voice.
export interface Offer { def: string; name: string; qty: number; /** what it is worth to them, in the same units as `wants` */ cost: number }
export interface Archetype {
  id: string; title: string;
  /** what it draws on, for people reading this (River is never told) */
  inspiration: string[];
  names: string[];
  /** how the figure is seen from a distance */
  appearance: string;
  hue: number;
  stay: [number, number];                    // world minutes
  /** how readily they warm to someone, 0..1 */
  warmth: number;
  wants: Record<string, number>;
  offers: Offer[];
  persona: string;
  lines: { greet: string[]; talk: string[]; ask: string[]; trade_yes: string[]; trade_no: string[]; short: string[]; farewell: string[]; remember: string[] };
}

export const ARCHETYPES: Archetype[] = [
  {
    id: "peddler", title: "peddler", names: ["Orrin", "Maud", "Tobias", "Ilse"], hue: 0x7a4f9a, stay: [10, 16], warmth: 0.5,
    inspiration: ["the wandering merchant of folk tales and old games: pleasant, unhurried, and not saying where the goods came from", "the travelling pedlar of Hardy and Dickens"],
    appearance: "A stooped figure under a bundle of pots, cord and oddments, walking as if the ground belonged to them.",
    wants: { shell: 3, pigment: 4, chalk: 2, flower: 1, mushroom: 1, keepsake: 5 },
    offers: [{ def: "cord", name: "length of cord", qty: 2, cost: 3 }, { def: "charcoal", name: "piece of charcoal", qty: 3, cost: 3 }, { def: "copper_ingot", name: "copper ingot", qty: 1, cost: 8 }, { def: "hide", name: "animal hide", qty: 1, cost: 4 }],
    persona: "a travelling peddler: mild, unhurried, mercantile, fond of understatement. You trade small useful things for small odd ones. You never say where your goods come from or where you go next.",
    lines: {
      greet: ["\"Morning, or whatever it is. Mind the pots.\"", "\"Ah. Someone. I had begun to think the place was uninhabited.\""],
      talk: ["\"Mm. Is that so.\"", "\"I've heard worse said of better places.\"", "\"Everything has a price, but not everything has a buyer.\""],
      ask: ["\"Where do I come from? Round and about. Where are you from, then?\"", "\"Questions, questions. I'd sooner talk about what's in the pack.\""],
      trade_yes: ["\"Done. A pleasure.\"", "\"Fair. Take it before I think better of it.\""], trade_no: ["\"Not enough, I'm afraid. I have to eat too.\"", "\"Ha. No.\""],
      short: ["\"Speak up, I'm old, not stupid.\""], farewell: ["\"Well. The tide waits for no one, and neither do I.\"", "\"Back to the road. Mind yourself.\""],
      remember: ["\"You again. Good. Last time was fair dealing.\"", "\"I remember you. You drive a decent bargain.\""],
    },
  },
  {
    id: "castaway", title: "castaway", names: ["Wen", "Calder", "Pip", "Sorrel"], hue: 0xc9a46a, stay: [14, 24], warmth: 0.85,
    inspiration: ["Cast Away and Robinson Crusoe: a person alone too long, talkative and a little too glad", "Friday: the stranger who becomes company"],
    appearance: "A sunburnt, ragged figure with a fishing spear, who keeps looking back toward the water as if checking it is still there.",
    wants: { berry: 2, meat: 4, fish: 3, flower: 2, mushroom: 1, charcoal: 1 },
    offers: [{ def: "plank", name: "driftwood plank", qty: 1, cost: 3 }, { def: "shell", name: "shell", qty: 3, cost: 2 }, { def: "bottle", name: "bottle", qty: 1, cost: 4 }, { def: "reed", name: "reed", qty: 4, cost: 2 }],
    persona: "a castaway who has been alone far longer than is good for them: warm, rambling, quick to laugh, quick to go quiet, grateful for anyone. You talk too much and then apologise for it. You never claim to know a way off the island.",
    lines: {
      greet: ["\"Hello! Hello. You're real. Sorry, I'm talking, aren't I.\"", "\"Oh. Oh, good. I wasn't sure anyone was— sorry. Hello.\""],
      talk: ["\"Yes. Yes, that's it exactly. I think.\"", "\"I used to count the waves. Don't ask. Go on.\"", "\"It's so good to be talked at by someone who answers back.\""],
      ask: ["\"Where from? Out there. A long way. I'd rather not say it aloud, if you don't mind.\"", "\"Me? I'm just... passing. Staying. It's the same thing here.\""],
      trade_yes: ["\"Yes! Take it, take it. I've nothing else to do with it.\"", "\"That's more than fair. Thank you.\""], trade_no: ["\"I'd love to, but I can't spare it. Sorry. Sorry.\"", "\"Not that. Anything but that. Sorry.\""],
      short: ["\"Sorry, what? I drifted.\""], farewell: ["\"I'll go before I wear out your patience. It was lovely. It was really lovely.\"", "\"If I don't see you again— no. See you again.\""],
      remember: ["\"You came back! I mean— of course you did. You live here.\"", "\"You remembered me. People do that, don't they.\""],
    },
  },
  {
    id: "child", title: "child", names: ["Lark", "Moss", "Tam", "Wren"], hue: 0xe0b84a, stay: [8, 14], warmth: 0.7,
    inspiration: ["The Little Prince: a visitor who asks the questions that matter and is unimpressed by the answers", "the uncanny calm of children in stories set on strange shores"],
    appearance: "A small figure in a coat too big for them, who stops to look at everything and is not at all afraid.",
    wants: { flower: 3, shell: 3, seed: 2, berry: 1, keepsake: 4 },
    offers: [{ def: "seed", name: "seed", qty: 3, cost: 2 }, { def: "flower", name: "flower", qty: 2, cost: 1 }, { def: "keepsake", name: "pebble with a hole in it", qty: 1, cost: 3 }],
    persona: "a child who has appeared on the island without explanation and is perfectly at ease: curious, literal, direct, a little odd. You ask short questions. You are not frightened of anything and not impressed by adults. You never explain how you got here.",
    lines: {
      greet: ["\"Hello. Are you the one who lives here?\"", "\"You're big. Do you know where the water goes?\""],
      talk: ["\"Why?\"", "\"That's a strange thing to be sure of.\"", "\"I like it here. It doesn't mind being looked at.\""],
      ask: ["\"I came on the water. You can too, I think.\"", "\"Do you ever count the stars? There are more on this side.\""],
      trade_yes: ["\"Okay. That's a good one.\"", "\"You can have it. I'll find another.\""], trade_no: ["\"No. That's mine.\"", "\"It isn't worth that.\""],
      short: ["\"I didn't hear. Say it again?\""], farewell: ["\"I have to go. It's getting the wrong sort of light.\"", "\"Bye. Don't forget the stars.\""],
      remember: ["\"I know you. You were here before.\"", "\"You're still here. Good.\""],
    },
  },
  {
    id: "hermit", title: "hermit", names: ["Hale", "Brannoch", "Edda", "Ames"], hue: 0x4a6a4a, stay: [8, 12], warmth: 0.25,
    inspiration: ["Walden and Hatchet: someone who chose the wild and does not want it explained to them", "the old keeper at the edge of the map in a hundred stories: gruff, exact, impossible to impress"],
    appearance: "A tall, weathered figure in a coat of patched hide, who stands slightly apart and watches the tree line more than you.",
    wants: { book: 6, pigment: 3, lamp: 6, charcoal: 1, chalk: 2, keepsake: 3 },
    offers: [{ def: "hide", name: "animal hide", qty: 2, cost: 4 }, { def: "cord", name: "length of cord", qty: 3, cost: 3 }, { def: "stone_knife", name: "stone knife", qty: 1, cost: 6 }],
    persona: "a hermit who came to this island to be left alone, and finds you tolerable: gruff, exact, sparing with words, dry. You say what is so and nothing more. You never give advice unless asked twice, and you never praise.",
    lines: {
      greet: ["\"You'll be the one making all the noise.\"", "\"Hm. Another one.\""],
      talk: ["\"If you say so.\"", "\"That's one way.\"", "\"Mind the tree line at night. That's all I'll say.\""],
      ask: ["\"I came here because it was quiet. It was.\"", "\"My business is my own. Yours, I gather, is chatter.\""],
      trade_yes: ["\"Fair enough.\"", "\"Take it. Don't hover.\""], trade_no: ["\"No.\"", "\"Not for that.\""],
      short: ["\"Speak plainly.\""], farewell: ["\"I'll be off.\"", "\"Enough company for one season.\""],
      remember: ["\"You again. You've not burnt the place down. Good.\"", "\"Hm. You've kept your head.\""],
    },
  },
];

export const archetypeById = (id: string) => ARCHETYPES.find((a) => a.id === id);
