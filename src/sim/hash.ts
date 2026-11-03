// Canonical state hashing: stable key order, rejects non-finite numbers.
/** Canonical hash: sorted keys, rejects non-finite numbers. */
export function canonicalHash(value: unknown): string {
  const canon = (v: unknown, at: string): unknown => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`non-finite number (${v}) at ${at}`);
    if (Array.isArray(v)) return v.map((x, i) => canon(x, `${at}[${i}]`));
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as any)[k], `${at}.${k}`)]));
    return v;
  };
  const text = JSON.stringify(canon(value, "$"));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
