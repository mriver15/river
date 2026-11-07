// The turn of the year. Pure functions of the world day, so the server, the client and the tests all agree without anything being stored.
// A year is four seasons of `seasonDays` world days each. The day length does not change; what changes is the cold, how fast things grow, the weather,
// and who is about.

export type SeasonId = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly SeasonId[] = ["spring", "summer", "autumn", "winter"];

export interface Season {
  id: SeasonId;
  /** 0..3 */
  index: number;
  /** 1-based day within the season */
  day: number;
  /** how far through the season, 0..1 */
  progress: number;
  year: number;
}

/** A new world begins partway into spring, so the first days are mild. 0 days per season means no seasons: it is always the same mild summer. */
export function seasonAt(worldDay: number, seasonDays: number): Season {
  if (!(seasonDays > 0)) return { id: "summer", index: 1, day: 1, progress: 0.5, year: 1 };
  const d = Math.max(0, worldDay - 1) + seasonDays * 0.5, n = Math.floor(d / seasonDays), within = d - n * seasonDays;
  return { id: SEASONS[((n % 4) + 4) % 4]!, index: ((n % 4) + 4) % 4, day: Math.floor(within) + 1, progress: within / seasonDays, year: Math.floor(n / 4) + 1 };
}

export interface SeasonRules {
  /** how much more (or less) the cold takes from a body, as a multiple */
  cold: number;
  /** warmth the daytime sun gives back when it is clear, per second */
  sun: number;
  /** how fast bushes and trees grow back what is taken, as a multiple */
  regrow: number;
  /** how much creatures that eat plants can thrive, per hour of world time (negative: they dwindle) */
  growth: number;
  /** weather: weights multiplied into the usual chances */
  weather: Partial<Record<"clear" | "cloudy" | "rain" | "fog" | "windy" | "storm", number>>;
  /** what the year says, once, as it arrives */
  arrives: string;
  /** colours the client leans the land toward */
  leaf: number; leafMix: number; ground: [number, number, number]; sky: number;
}

export const RULES: Record<SeasonId, SeasonRules> = {
  spring: { cold: 1.0, sun: 0.03, regrow: 1.6, growth: 0.012, weather: { rain: 1.5, fog: 1.2, clear: 0.9 },
    arrives: "The air has softened. There are new leaves on everything, and the ground smells of rain and growing.", leaf: 0xa8d86a, leafMix: 0.28, ground: [0.96, 1.06, 0.96], sky: 0xbfd8c8 },
  summer: { cold: 0.6, sun: 0.04, regrow: 1.2, growth: 0.006, weather: { clear: 1.4, storm: 1.3, rain: 0.8, fog: 0.5 },
    arrives: "The warmth has settled in. The light stays long on the grass, and the air is full of small, busy sounds.", leaf: 0x3f8a4a, leafMix: 0, ground: [1, 1, 1], sky: 0xcfe3f0 },
  autumn: { cold: 1.15, sun: 0.025, regrow: 0.8, growth: -0.004, weather: { fog: 1.8, windy: 1.5, cloudy: 1.3, clear: 0.8 },
    arrives: "There is an edge to the mornings now. The leaves are turning, and they begin to let go.", leaf: 0xc9772e, leafMix: 0.62, ground: [1.1, 0.96, 0.8], sky: 0xe3c9a8 },
  winter: { cold: 1.7, sun: 0.012, regrow: 0.2, growth: -0.014, weather: { cloudy: 1.5, storm: 1.2, windy: 1.3, rain: 0.7, clear: 0.7 },
    arrives: "The cold has come to stay. The trees are bare, and the island is quieter than it has been.", leaf: 0x7a6a58, leafMix: 0.78, ground: [0.9, 0.96, 1.1], sky: 0xb8c6d6 },
};

export const rulesFor = (worldDay: number, seasonDays: number): SeasonRules => RULES[seasonAt(worldDay, seasonDays).id];
