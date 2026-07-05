// Parse a .fit file and print the extracted summary, without touching the DB.
// Usage: npm run parse-fit -- path/to/file.fit
import { readFileSync } from "fs";
import { parseFit } from "../lib/fit";

async function main() {
  const path = process.argv[2] ?? "test/fixtures/cycling.fit";
  const parsed = await parseFit(readFileSync(path));
  const { records, rawSession, ...summary } = parsed;
  console.log(summary);
  console.log(`records: ${records.length}`);
  console.log("first record:", records[0]);
  console.log("last record:", records[records.length - 1]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
