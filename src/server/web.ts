import dns from "node:dns/promises";
import net from "node:net";

const UA = "Mozilla/5.0 (compatible; RiverAgent/1.0)";
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");
const strip = (h: string) => decode(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export async function webSearch(query: string): Promise<string> {
  const tavily = process.env.TAVILY_API_KEY;
  if (tavily) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tavily}` },
      body: JSON.stringify({ query, max_results: 5, include_answer: true }), signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`search failed (${r.status})`);
    const d: any = await r.json();
    return [d.answer ? `Summary: ${d.answer}` : "", ...(d.results ?? []).map((x: any) => `- ${x.title} <${x.url}>\n  ${clip(x.content ?? "", 300)}`)].filter(Boolean).join("\n");
  }
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`search failed (${r.status})`);
  const html = await r.text();
  const out: string[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html)) && out.length < 6; ) {
    let url = decode(m[1]); const u = /uddg=([^&]+)/.exec(url); if (u) url = decodeURIComponent(u[1]);
    out.push(`- ${strip(m[2])} <${url}>\n  ${clip(strip(m[3]), 300)}`);
  }
  return out.length ? out.join("\n") : "No results.";
}

const privateIp = (ip: string) =>
  net.isIPv4(ip) ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) : /^(::1|fc|fd|fe80)/i.test(ip) || ip === "::";

/** Fetch a public web page as plain text. Refuses localhost/private networks (the agent is steerable by page content). */
export async function webFetch(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("only http(s) URLs");
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  if (addrs.some((a) => privateIp(a.address))) throw new Error("that address is not on the public internet");
  const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`fetch failed (${r.status})`);
  const type = r.headers.get("content-type") ?? "";
  if (!/text|json|xml/.test(type)) throw new Error(`unsupported content type ${type}`);
  let t = (await r.text()).slice(0, 400_000);
  if (/html/.test(type)) t = strip(t.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " "));
  return clip(t, 6000);
}
