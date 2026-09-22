import { readFile } from "node:fs/promises";
import { pool } from "../src/db";

async function main() {
  let checked = 0;
  for (const file of ["src/app/reports/page.tsx", "src/lib/campaign-reporting.ts"]) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/db.execute\(sql`([\s\S]*?)`\)/g)) {
      const query = match[1].replaceAll('${humanEvent}', "coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true")
        .replaceAll('${campaignId}', "'00000000-0000-0000-0000-000000000000'")
        .replaceAll('${limit}', "30")
        .replaceAll('${timeWhere}', "true");
      await pool.query(query);
      checked++;
    }
  }
  await pool.query("select * from provider_cooldowns order by updated_at desc limit 1");
  if (checked !== 9) throw new Error(`Reports query inventory changed (expected 9, found ${checked}); update this check before deployment`);
  console.log(`Reports: ${checked} analytics queries and cooldown schema passed against the deployed database.`);
}
main().catch(error => { console.error("Reports database check failed:", error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
