// The decision packet: what River's mind is shown when it is woken. A bounded, structured summary, not a transcript.
// Fixed parts (identity, abilities) are never trimmed. The rest is divided among sections; inside a section, critical items are
// always kept and the others are admitted by salience until the section's share is used up.

export type SectionName = "state" | "observations" | "memories";
export interface Item { text: string; critical?: boolean; /** higher is kept first */ weight?: number }
export interface Section { name: SectionName; title: string; items: Item[] }

/** Roughly four characters to a token for English prose; conservative enough to budget with. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.8);

/** Spec §8.2: 25% identity/abilities (fixed), 20% state, 25% observations, 20% memories, 10% reserve for the answer. */
export const SHARES: Record<SectionName, number> = { state: 20, observations: 25, memories: 20 };

export interface SectionReport { name: SectionName; allocated: number; used: number; kept: number; dropped: number; overCritical: boolean }
export interface Packet { text: string; tokens: number; sections: SectionReport[] }

/**
 * @param total   the input budget for the whole call, in tokens
 * @param fixed   tokens already spent on identity and abilities (system prompt, tool list)
 */
export function assemble(sections: Section[], total: number, fixed: number): Packet {
  const room = Math.max(0, total - fixed), shareSum = sections.reduce((a, s) => a + SHARES[s.name], 0) || 1;
  const blocks: string[] = [], reports: SectionReport[] = [];
  for (const s of sections) {
    const allocated = Math.floor((room * SHARES[s.name]) / shareSum), head = estimateTokens(`## ${s.title}\n`);
    let used = head;
    const keep = new Set<number>();
    s.items.forEach((it, i) => { if (it.critical) { keep.add(i); used += estimateTokens(it.text) + 1; } });          // never traded away
    const overCritical = used > allocated;
    const rest = s.items.map((it, i) => ({ it, i })).filter((x) => !x.it.critical).sort((a, b) => (b.it.weight ?? 0) - (a.it.weight ?? 0) || a.i - b.i);
    for (const { it, i } of rest) {
      const cost = estimateTokens(it.text) + 1;
      if (used + cost > allocated) continue;                       // try the smaller, lower-ranked ones that still fit
      keep.add(i); used += cost;
    }
    const kept = [...keep].sort((a, b) => a - b).map((i) => s.items[i]!.text);
    if (kept.length) blocks.push(`## ${s.title}\n${kept.join("\n")}`);
    reports.push({ name: s.name, allocated, used: kept.length ? used : 0, kept: kept.length, dropped: s.items.length - kept.length, overCritical });
  }
  const text = blocks.join("\n\n");
  return { text, tokens: estimateTokens(text), sections: reports };
}
