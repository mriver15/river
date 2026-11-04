// Screenshot the visual gallery (every item in every condition, garments on the body, the fallback) with headless Firefox.
//   tsx scripts/gallery-shots.ts [outDir]     default outDir: .fixtures/shots
// Builds the client, serves dist/client on a free port, and writes one PNG per gallery section. Needs Firefox (FIREFOX=path to override).
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? ".fixtures/shots");
const firefox = process.env.FIREFOX ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
if (!fs.existsSync(firefox)) { console.error(`no browser at ${firefox}; set FIREFOX`); process.exit(2); }
if (spawnSync("npm", ["run", "-s", "build"], { stdio: "inherit" }).status !== 0) process.exit(1);
fs.mkdirSync(out, { recursive: true });
const port = 8900 + Math.floor(Math.random() * 90);
const server = spawn("python3", ["-m", "http.server", String(port), "--directory", "dist/client"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
let failed = false;
for (const [name, query, size] of [["items", "?only=items", "1200,9000"], ["garments", "?only=garments", "1200,400"], ["worn", "?only=worn", "1200,2200"], ["fallback", "?only=fallback", "1200,300"]] as const) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "river-ff-"));
  const file = path.join(out, `gallery-${name}.png`);
  spawnSync(firefox, ["--headless", "--no-remote", "--profile", profile, `--window-size=${size}`, "--screenshot", file, `http://localhost:${port}/gallery.html${query}`], { stdio: "ignore", timeout: 90_000 });
  const ok = fs.existsSync(file) && fs.statSync(file).size > 5000;
  console.log(`${ok ? "wrote" : "FAILED"} ${file}`); failed ||= !ok;
  fs.rmSync(profile, { recursive: true, force: true });
}
server.kill();
process.exit(failed ? 1 : 0);
