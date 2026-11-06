// A screenshot of the TV view, for looking at it without a TV:  tsx scripts/tv-shot.ts [outFile=.fixtures/shots/tv.png] [seconds=9] [width=1920] [height=1080]
// Runs the real server on a copy of the new-life fixture with the mock brain, serves a copy of the page that holds its load event open for a few
// seconds (so the world has arrived and the TV view has settled when the browser takes its picture), and uses headless Firefox.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? ".fixtures/shots/tv.png"), seconds = Number(process.argv[3] ?? 9), W = process.argv[4] ?? "1920", H = process.argv[5] ?? "1080";
const firefox = process.env.FIREFOX ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
if (!fs.existsSync(firefox)) { console.error(`no browser at ${firefox}; set FIREFOX`); process.exit(2); }
const dist = path.resolve("dist/client", "index.html");
if (!fs.existsSync(dist)) { console.error("run `npm run build` first"); process.exit(2); }
fs.mkdirSync(path.dirname(out), { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-tvshot-")), db = path.join(dir, "t.db"); fs.copyFileSync(path.resolve(".fixtures/new-life.db"), db);
const hold = http.createServer((_, res) => setTimeout(() => { res.statusCode = 204; res.end(); }, seconds * 1000)); await new Promise<void>((r) => hold.listen(8871, r));
const page = path.resolve("dist/client", "tv-shot.html");
fs.writeFileSync(page, fs.readFileSync(dist, "utf8").replace("</body>", `<img src="http://localhost:8871/hold" width="1" height="1" style="position:fixed;opacity:0"></body>`));
const server = process.env.SHOT_REPLAY      // SHOT_REPLAY=<recorded.db> pictures the replay viewer instead of a live world
  ? spawn(process.execPath, ["--import", "tsx", "scripts/replay-serve.ts", process.env.SHOT_REPLAY, "", "8872"], { env: { ...process.env, REPLAY_SPEED: process.env.REPLAY_SPEED ?? "64" }, stdio: "ignore" })
  : spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: db, PORT: "8872", MOCK_LLM: "1", EMBED_DISABLED: "1" }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 5000));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "river-ff-"));
const ff = spawn(firefox, ["--headless", "--no-remote", "--profile", profile, `--window-size=${W},${H}`, "--screenshot", out, `http://localhost:8872/tv-shot.html${process.env.SHOT_QUERY ?? "?tv"}`], { stdio: "ignore" });     // not spawnSync: this process serves the hold request
const killer = setTimeout(() => ff.kill("SIGKILL"), (seconds + 60) * 1000);
const r = { status: await new Promise<number | null>((res) => ff.on("exit", res)) }; clearTimeout(killer);
server.kill("SIGTERM"); hold.close(); fs.rmSync(page, { force: true }); fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true });
console.log(fs.existsSync(out) && fs.statSync(out).size > 5000 ? `wrote ${out}` : `FAILED (${r.status})`);
process.exit(fs.existsSync(out) ? 0 : 1);
