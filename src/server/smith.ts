// The tool smith: turns an approved "new tool idea" into a plugin.
//   request → LLM writes plugin → static checks → typecheck → smoke test in a throwaway world
//   → staged for your review (or auto-installed with RIVER_AUTO_INSTALL=1) → hot-loaded, no restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bus, log } from "./bus.ts";
import { db } from "./db.ts";
import { chat, type ChatMessage } from "./llm.ts";
import { GATED, syncApprovals } from "./mind.ts";
import { BASE_TOOLS, PLUGIN_TOOLS, registerPlugin } from "./tools.ts";
import type { ForgedTool, ToolRequest } from "../shared/types.ts";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PLUGINS = path.join(ROOT, "src/server/plugins");
// staged files sit next to real plugins (so relative imports resolve and typecheck sees them); the loader skips "_" files
const stagedFile = (name: string) => path.join(PLUGINS, `_staged_${name}.ts`);
const FORGE_MODEL = process.env.RIVER_FORGE_MODEL;           // optional stronger model for writing code
const AUTO_INSTALL = process.env.RIVER_AUTO_INSTALL === "1";  // skip human review (see README caveat)
const MAX_ATTEMPTS = 3;

// ---------- records ----------
const row = (r: any): ForgedTool => ({ name: r.name, request_id: r.request_id, status: r.status, code: r.code, log: r.log, ts: r.ts });
export const forgedList = (): ForgedTool[] => (db.prepare("SELECT * FROM forged ORDER BY ts DESC LIMIT 30").all() as any[]).map(row);
function save(name: string, requestId: number, status: ForgedTool["status"], code: string, logText: string) {
  db.prepare("INSERT INTO forged(name, request_id, status, code, log, ts) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET status=excluded.status, code=excluded.code, log=excluded.log, ts=excluded.ts")
    .run(name, requestId, status, code, logText, Date.now());
  bus.emit("state");
}
const active = new Set<string>();   // builds running in THIS process (a DB row alone can be left over from a crash/restart)

/** On boot, any build still marked "forging" was interrupted by a restart. Mark it failed so it can be retried. */
export function reapInterrupted() {
  const r = db.prepare("UPDATE forged SET status='failed', log = log || char(10) || 'Interrupted by a server restart. Use \"Build it with the tool smith\" to retry.' WHERE status='forging'").run();
  if (Number(r.changes)) log("system", `Tool smith: ${r.changes} interrupted build(s) marked failed; retry from the Tools tab.`);
}
const get = (name: string) => { const r = db.prepare("SELECT * FROM forged WHERE name=?").get(name) as any; return r ? row(r) : null; };

// ---------- prompt ----------
const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const CHEATSHEET = `World API (the \`w\` argument of run):
- w.me: { x, z, heading, needs: {energy,hunger,mood,curiosity} (0-100), sleeping }
- w.nearby(radius) -> [{ e: Entity, d: number }] sorted by distance;  w.entities: Map<string, Entity>;  w.inReach(e) (within ~5m);  w.dist(e);  w.compass(e)
- Entity = { id, kind, name, x, z, props }. kinds: tree rock bush flower mushroom shell library shrine monolith campfire book item sprout structure pit animal trace.
  Gatherable things have props.yields (array of item kinds), props.stock, props.max, props.lastTake. Pickable things have props.takeable. props.desc is the inspect text.
- w.putEntity(e) persists a changed entity; w.spawn(kind, name, x, z, props) creates one; w.removeEntity(id). ONLY use existing entity kinds (the client has no mesh for new kinds); use "structure" or "item" for new visible things.
- Inventory: w.addItem(kind, name, desc, qty=1, props?); w.findItem(idOrName) -> item|undefined; w.takeItem(item.id, qty) consumes; items have {id, kind, name, desc, qty}. Stock item kinds: stick, stone, seed, berry, flower, mushroom, shell, book, crafted.
- log(kind, text, data?) from "../bus.ts": kind must be one of "world" | "observation" | "thought" | "speech" | "desire" | "system" | "need" | "inscription" (use "world" for happenings).
- w.bump({ energy?, hunger?, mood?, curiosity? }) adds (can be negative); w.setActivity("text"); w.spotNearMe(dist) -> {x,z} free spot near the agent; w.timeLabel().
- Takes time? \`await wait(ms)\` (import { wait } from "../toolkit.ts"; keep under 15s). It runs on the world clock and stops while the world is frozen. Need chance? \`rand()\` (import from "../toolkit.ts") returns [0,1). Never use setTimeout, Math.random or Date.now.
- Validate inputs and throw new ToolError("clear message the character can act on") for normal failures (missing item, too far away, nothing to do). Return a vivid second-person string describing what happens.`;

const SYSTEM = `You write small plugins ("tools") for River's island world, in TypeScript. A character named River asked for a tool; you implement exactly that request, grounded in how the world actually works.

Rules:
- Output ONE file in a single \`\`\`ts code block, nothing else but that block.
- Allowed imports ONLY: "../toolkit.ts" (ToolError, obj, str, num, wait, rand, type ToolDef) and "../bus.ts" (log). No node: modules, no other imports.
- Default-export a ToolDef whose \`name\` is exactly the requested name.
- The first line must be a comment with a realistic JSON argument object for a smoke test: // TEST_ARGS: {"with":"stick"}
- No network, no filesystem, no process/env access, no eval/dynamic import. Pure world logic.
- Tools should have real constraints (needs items, nearby entities, effort/time) and real effects on the world, inventory or needs, so the character's use of them matters. Don't make it a pure flavour-text generator, and don't make it trivially overpowered.
- Keep it under ~120 lines.

${CHEATSHEET}

--- toolkit.ts ---
${read(path.join(ROOT, "src/server/toolkit.ts"))}
--- an example plugin: plugins/dig.ts ---
${read(path.join(PLUGINS, "dig.ts"))}`;

// ---------- checks ----------
const FORBIDDEN = /\b(process|require|eval|Function|child_process|globalThis|fetch|XMLHttpRequest|WebSocket|Deno|Bun|setTimeout|setInterval|setImmediate)\b|Math\.random|Date\.now|new Date\b|\bimport\s*\(|__proto__|\.constructor\b|node:/;
function staticCheck(code: string, name: string): string[] {
  const problems: string[] = [];
  if (code.length > 12_000) problems.push("file too large");
  for (const m of code.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm))
    if (!["../toolkit.ts", "../bus.ts"].includes(m[1])) problems.push(`import of "${m[1]}" is not allowed`);
  const body = code.replace(/\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""'); // ignore comments and string contents
  const bad = body.match(FORBIDDEN);
  if (bad) problems.push(`forbidden construct: ${bad[0]}`);
  if (!new RegExp(`name:\\s*["']${name}["']`).test(code)) problems.push(`tool name must be exactly "${name}"`);
  if (!/export\s+default/.test(code)) problems.push("missing default export");
  return problems;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, cwd: ROOT });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => { p.kill("SIGKILL"); out += "\n[timed out]"; }, timeoutMs);
    p.on("error", (e) => { clearTimeout(t); resolve({ out: out + String(e), code: -1 }); });
    p.on("close", (code) => { clearTimeout(t); resolve({ out, code }); });
  });
}
const BIN = (n: string) => path.join(ROOT, "node_modules/.bin", n);

async function typecheck(file: string): Promise<string[]> {
  const { out } = await run(BIN("tsc"), ["--noEmit", "-p", "tsconfig.json"], process.env, 90_000);
  const rel = path.relative(ROOT, file);
  return out.split("\n").filter((l) => l.startsWith(rel));
}

async function smoke(file: string, argsJson: string): Promise<{ ok: boolean; out: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "river-smoke-"));
  // minimal env: generated code never sees API keys
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, RIVER_DB: path.join(tmp, "smoke.db") };
  const { out } = await run(BIN("tsx"), [path.join(ROOT, "src/server/smoke.ts"), file, argsJson], env, 45_000);
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = out.match(/^RESULT (.*)$/m);
  return m ? JSON.parse(m[1]) : { ok: false, out: out.slice(-600) };
}

/** Pull the file out of a model reply: fenced block (any language tag, closed or not), else the raw text if it looks like code. */
function extractCode(text: string): string {
  const fenced = /```[\w-]*[ \t]*\r?\n([\s\S]*?)(?:```|$)/.exec(text)?.[1]?.trim();
  if (fenced) return fenced;
  return /export\s+default/.test(text) ? text.trim() : "";
}

// ---------- forge ----------
export async function forge(req: ToolRequest, onStaged?: (t: ForgedTool) => void) {
  const name = req.name;
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(name)) return save(name, req.id, "failed", "", "Invalid tool name.");
  if (BASE_TOOLS.some((t) => t.name === name) || PLUGIN_TOOLS.some((t) => t.name === name) || (name in GATED && !get(name))) return save(name, req.id, "failed", "", "A tool with that name already exists.");
  if (active.has(name)) return;
  active.add(name);
  save(name, req.id, "forging", "", "Writing code…");
  log("system", `Tool smith: writing "${name}"…`);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Tool name: ${name}\nRiver's reason: ${req.reason}${req.note ? `\nThe human's note: ${req.note}` : ""}\n\nWrite the plugin.` },
  ];
  const trail: string[] = [];
  let code = "";
  const file = stagedFile(name);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const r = await chat({ consumer: "forge", reason: name, messages, maxTokens: 12000, model: FORGE_MODEL });
      messages.push(r.message);
      code = extractCode(r.text);
      let problems: string[] = [];
      let smokeOut = "";
      if (r.finish === "length") problems = ["Your reply was cut off for length. Write a shorter, simpler version (under ~80 lines)."];
      else if (!code) problems = ["No code block found in your reply."];
      else {
        problems = staticCheck(code, name);
        if (!problems.length) {
          fs.writeFileSync(file, code + "\n");
          problems = await typecheck(file);
          if (!problems.length) {
            const args = /\/\/\s*TEST_ARGS:\s*(.*)/.exec(code)?.[1] ?? "{}";
            const s = await smoke(file, args);
            smokeOut = s.out;
            if (!s.ok) problems = [`Smoke test crashed with args ${args}:`, s.out];
          }
        }
      }
      if (!problems.length) {
        trail.push(`Attempt ${attempt}: passed static checks, typecheck and smoke test.`, `Smoke test output:\n${smokeOut}`);
        const t: ForgedTool = { name, request_id: req.id, status: "staged", code, log: trail.join("\n"), ts: Date.now() };
        save(name, req.id, "staged", code, t.log);
        log("system", `Tool smith: "${name}" is ready for review.`);
        if (AUTO_INSTALL) await install(name); else onStaged?.(t);
        return;
      }
      trail.push(`Attempt ${attempt} failed (model finish=${r.finish}, reply ${r.text.length} chars, code ${code.length} chars):\n${problems.join("\n")}`);
      save(name, req.id, "forging", code, trail.join("\n") + `\nRetrying…`);
      messages.push({ role: "user", content: `That didn't pass:\n${problems.join("\n")}\nFix it and send the complete file again in one code block.` });
    }
    save(name, req.id, "failed", code, trail.join("\n"));
    log("system", `Tool smith: could not build "${name}" after ${MAX_ATTEMPTS} attempts.`);
  } catch (e: any) {
    save(name, req.id, "failed", code, `${trail.join("\n")}\nError: ${e.message}`);
    log("system", `Tool smith error for "${name}": ${e.message}`);
  } finally {
    active.delete(name);
    if (get(name)?.status !== "staged") fs.rmSync(file, { force: true });
  }
}

/** Move a staged plugin into plugins/, hot-load it and switch it on. */
export async function install(name: string): Promise<ForgedTool | null> {
  const f = get(name);
  if (!f || f.status !== "staged") return null;
  const dest = path.join(PLUGINS, `${name}.ts`);
  fs.writeFileSync(dest, f.code + "\n");
  fs.rmSync(stagedFile(name), { force: true });
  await registerPlugin(dest, true);
  db.prepare("INSERT INTO tools(name, approved) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET approved=1").run(name);
  syncApprovals();
  save(name, f.request_id, "installed", f.code, f.log + "\nInstalled.");
  log("system", `Tool "${name}" installed and live.`);
  return get(name);
}

export function reject(name: string) {
  const f = get(name);
  if (!f || f.status !== "staged") return;
  fs.rmSync(stagedFile(name), { force: true });
  save(name, f.request_id, "rejected", f.code, f.log + "\nRejected by human.");
}
