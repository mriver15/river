// Named sets of parameter values. Applying one is a single recorded command that sets each value in it; what it does not mention is left alone.
export interface Preset { id: string; label: string; help: string; values: Record<string, number | boolean> }
export const PRESETS: Preset[] = [
  { id: "default", label: "Standard", help: "How the world was designed to run.", values: {} },
  { id: "gentle", label: "Gentle", help: "Slower needs, softer animals, fewer falls: a place to learn in.", values: { needsRate: 0.5, damageScale: 0.5, fallRate: 0.5, predators: false } },
  { id: "harsh", label: "Harsh", help: "Faster needs, harder animals, more falls.", values: { needsRate: 1.5, damageScale: 1.5, fallRate: 1.5, predators: true } },
  { id: "lively", label: "Lively", help: "More strange and beautiful events, and feelings that come and go faster.", values: { ambientRate: 2, emotionSpeed: 1.5 } },
  { id: "quiet", label: "Quiet", help: "Few events, slow-fading feelings: a contemplative world.", values: { ambientRate: 0.25, emotionSpeed: 0.6 } },
  { id: "close", label: "Close horizons", help: "River sees less far, by day and by night.", values: { sightDay: 20, sightNight: 7 } },
];
export const presetById = (id: string) => PRESETS.find((p) => p.id === id);
