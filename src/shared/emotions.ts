// River's feelings. Each is a 0..1 intensity that rises on events and fades over time.
// They are offered to River as signals ("here is how it feels"), never as orders.
export type EmotionName = "wonder" | "boredom" | "longing" | "loneliness" | "frustration" | "playfulness" | "pride" | "dread" | "grief";

export const EMOTIONS: Record<EmotionName, { noun: string; label: string; color: string; felt: string; half: number }> = {
  wonder:      { noun: "wonder", label: "wonder",      color: "#7fd0ea", half: 120, felt: "A hush of wonder: things seem larger, and more connected, than they did a moment ago." },
  boredom:     { noun: "restlessness", label: "restless",    color: "#8a93a6", half: 200, felt: "Restless. You've been circling the same few things, and the circle has gone dull." },
  longing:     { noun: "longing", label: "longing",     color: "#b69cff", half: 600, felt: "A pull toward something past (a place, a moment, a version of the day) that you can't quite return to." },
  loneliness:  { noun: "loneliness", label: "lonely",      color: "#7aaaff", half: Infinity, felt: "The island is very quiet. It has been a long time since anyone spoke to you." },
  frustration: { noun: "frustration", label: "frustrated",  color: "#ff8a65", half: 300, felt: "Something keeps not working, and your hands feel tight with it." },
  playfulness: { noun: "playfulness", label: "playful",     color: "#ffd166", half: 240, felt: "Light, a little mischievous: the itch to try something just to see, for no reason." },
  pride:       { noun: "pride", label: "proud",       color: "#7fd1ae", half: 300, felt: "A settled warmth at having made something real." },
  dread:       { noun: "fear", label: "afraid",      color: "#ec7272", half: 90, felt: "Your chest is tight; something here isn't safe." },
  grief:       { noun: "grief", label: "grieving",    color: "#a58bb8", half: 900, felt: "A hollow ache for something that's gone." },
};
export const EMOTION_ORDER = Object.keys(EMOTIONS) as EmotionName[];
export const BITTERSWEET = "Joy and sorrow at once, each making the other clearer.";
export const intensityWord = (v: number) => (v > 0.75 ? "overwhelming" : v > 0.5 ? "strong" : "mild");
