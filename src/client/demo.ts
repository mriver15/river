import { compile, type Score } from "../shared/music.ts";

/** A built-in piece so there is something to hear (and to test the speakers with) before River has composed anything. D minor: i - VII - VI - V. */
export const DEMO: Score = compile({
  title: "Demo: Morning on the island", tempo: 76, repeat: 2,
  voices: [
    { instrument: "voice", name: "pad", notes: "[D3 A3 D4]:8 [C3 G3 E4]:8 [Bb2 F3 D4]:8 [A2 E3 C4]:8", volume: 0.7 },
    { instrument: "strings", name: "arpeggio", notes: "(D3 A3 D4 A3)x2 (C3 G3 C4 G3)x2 (Bb2 F3 Bb3 F3)x2 (A2 E3 A3 E3)x2", volume: 0.75 },
    { instrument: "flute", name: "melody", notes: "A4:2 F4 G4 A4:2 D5:2 C5:2 A4 G4 E4:2 G4:2 F4:2 A4 Bb4 D5:3 C5 E5:2 D5 C#5 A4:4", volume: 0.9 },
    { instrument: "chimes", name: "bells", notes: "_:6 A5:2 _:6 G5:2 _:6 F5:2 _:6 E5:2", volume: 0.5 },
    { instrument: "stones", name: "pulse", notes: "(k _ _ h _ s _ h)x4", volume: 0.5 },
  ],
});
