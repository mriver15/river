// Write a legacy-shaped database for rehearsing the migration:  tsx scripts/make-legacy-db.ts [file=.fixtures/legacy.db]
import path from "node:path";
import { makeLegacyDb } from "./legacy-fixture.ts";
const f = path.resolve(process.argv[2] ?? ".fixtures/legacy.db"); makeLegacyDb(f); console.log(`wrote ${f}`);
