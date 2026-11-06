// What did River do over a run, and was it open-ended? Reads a database read-only.
//   tsx scripts/behaviour-report.ts <river.db> [--json]       compare runs by passing several files
import { DatabaseSync } from "node:sqlite";
import { behaviourReport, formatReport } from "../src/server/behaviour.ts";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--")), json = process.argv.includes("--json");
if (!files.length) { console.error("usage: behaviour-report.ts <river.db> [more.db ...] [--json]"); process.exit(2); }
const out = files.map((f) => { const d = new DatabaseSync(f, { readOnly: true }); const r = behaviourReport(d); d.close(); return { file: f, report: r }; });
if (json) console.log(JSON.stringify(out.length === 1 ? out[0].report : out, null, 2));
else for (const o of out) console.log(formatReport(o.report, o.file) + "\n");
