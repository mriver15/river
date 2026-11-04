// The engine's side of the plugin boundary: start an isolated process, give it a snapshot, take back a result, and check everything.
// The sandbox process cannot reach the world, the database, the network, the filesystem or other processes; a plugin's only output is
// a result that is validated against the contract and the plugin's pinned capabilities before any of it is applied.
import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { LIMITS, SDK_VERSION, type Journaled, type RunResult } from "./contract.ts";

const RUNNER = fs.realpathSync(fileURLToPath(new URL("./runner.mjs", import.meta.url)));
export const hashOf = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 16);
export const toJs = (source: string) => stripTypeScriptTypes(source, { mode: "strip" });

/** Counters for the dashboard and the unattended-run limits. */
export const sandboxStats = { runs: 0, timeouts: 0, crashes: 0, killed: 0, active: 0, peakActive: 0 };
const MAX_ACTIVE = 2;
const waiting: (() => void)[] = [];
async function slot() { if (sandboxStats.active >= MAX_ACTIVE) await new Promise<void>((r) => waiting.push(r)); sandboxStats.active++; sandboxStats.peakActive = Math.max(sandboxStats.peakActive, sandboxStats.active); }
const release = () => { sandboxStats.active--; waiting.shift()?.(); };

/** One job in a fresh process: it is killed when it answers or when the wall clock runs out, so nothing it does can outlive the call. */
async function job(kind: "run" | "describe", source: string, input: unknown): Promise<{ out?: string; error?: string; timeout?: boolean; killed?: boolean }> {
  await slot();
  sandboxStats.runs++;
  let code: string;
  try { code = toJs(source); } catch (e) { release(); return { error: `the source could not be read as TypeScript: ${(e as Error).message}` }; }
  return new Promise((resolve) => {
    let child: ChildProcess, done = false;
    const finish = (r: { out?: string; error?: string; timeout?: boolean; killed?: boolean }) => {
      if (done) return;                                                    // a late answer, or one from a process already given up on, is ignored
      done = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch { /* already gone */ } release(); resolve(r);
    };
    child = fork(RUNNER, [], {
      execArgv: ["--permission", `--allow-fs-read=${RUNNER}`, `--max-old-space-size=${LIMITS.heapMb}`, "--disallow-code-generation-from-strings", "--no-warnings"],
      env: {}, cwd: fs.realpathSync("/"), stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "json",
    });
    const timer = setTimeout(() => { sandboxStats.timeouts++; sandboxStats.killed++; finish({ timeout: true, killed: true, error: `ran past ${LIMITS.wallMs / 1000} seconds` }); }, LIMITS.wallMs);
    child.on("error", (e) => finish({ error: `could not start: ${e.message}` }));
    child.on("exit", (c, sig) => { if (!done) { sandboxStats.crashes++; finish({ error: sig ? `ended by ${sig}` : `exited with code ${c} (most likely out of memory)`, killed: true }); } });
    child.on("message", (raw) => {
      let m: { ready?: boolean; id?: number; out?: string; error?: string; timeout?: boolean };
      try { m = JSON.parse(String(raw)); } catch { return finish({ error: "unreadable reply" }); }
      if (m.ready) return void child.send({ t: kind, id: 1, code, cpuMs: LIMITS.cpuMs, input });
      if (m.id !== 1) return;                                              // not the job we sent: fenced out
      if (m.error) { if (m.timeout) sandboxStats.timeouts++; return finish({ error: m.error, timeout: m.timeout }); }
      finish({ out: m.out });
    });
  });
}

/** What a plugin says it is. The engine never imports plugin source: it asks the sandbox. */
export async function describePlugin(source: string): Promise<{ name: string; description: string; input_schema: any } | { error: string }> {
  const r = await job("describe", source, { me: { x: 0, z: 0, heading: 0, needs: {}, sleeping: false, name: "" }, entities: [], inventory: [], reach: 5, timeLabel: "", spots: {}, caps: {}, rng: [], limits: { waitMs: LIMITS.waitMs }, args: {} });
  if (r.error || !r.out) return { error: r.error ?? "no answer" };
  try { const d = JSON.parse(r.out); return typeof d.name === "string" && typeof d.description === "string" && d.input_schema?.type === "object" ? d : { error: "it does not default-export a tool with a name, description and input schema" }; } catch { return { error: "unreadable description" }; }
}

export interface Snapshot { me: unknown; entities: unknown[]; inventory: unknown[]; reach: number; timeLabel: string; spots: Record<string, { x: number; z: number }>; caps: Record<string, string[]>; rng: number[]; limits: { waitMs: number }; args: unknown }

/** Run one plugin against a snapshot. Always resolves; a failure is a result with a reason, never an exception. */
export async function runPlugin(source: string, snapshot: Snapshot, meta: { name: string; hash: string; gen: number; tick: number }): Promise<Journaled> {
  const base = { v: SDK_VERSION, ...meta };
  const r = await job("run", source, snapshot);
  if (r.timeout) return { ...base, ok: false, failure: "timeout", message: "It took too long and was stopped." };
  if (r.error) return { ...base, ok: false, failure: r.killed ? "limit" : "crash", message: r.error };
  try { const res = JSON.parse(r.out!) as RunResult; return { ...res, ...base, v: res.v }; } catch { return { ...base, ok: false, failure: "contract", message: "The result was not readable." }; }
}
