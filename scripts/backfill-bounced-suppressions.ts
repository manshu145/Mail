import { pool } from "../src/db";

async function main() {
  const result = await pool.query(`
    insert into suppressions (
      email, normalized_email, reason, source, contact_id, note, created_at
    )
    select
      m.recipient_email,
      lower(trim(m.recipient_email)),
      'bounce'::suppression_reason,
      'bounce_backfill',
      m.contact_id,
      coalesce(m.last_error,'Backfilled from terminal bounced message'),
      coalesce(m.bounced_at,now())
    from messages m
    where m.status='bounced'
    on conflict(normalized_email) do nothing
  `);
  console.log(`[backfill-bounced-suppressions] inserted ${result.rowCount || 0} missing suppressions`);
}

main()
  .catch((error) => {
    console.error("[backfill-bounced-suppressions]", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
