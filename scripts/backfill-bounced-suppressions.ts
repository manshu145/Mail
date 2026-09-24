import { pool } from "../src/db";

async function main() {
  const result = await pool.query(`
    insert into suppressions (
      email, normalized_email, reason, source, contact_id, note, created_at
    )
    select
      m.recipient_email,
      lower(trim(m.recipient_email)),
      'hard_bounce'::suppression_reason,
      'bounce_backfill',
      m.contact_id,
      coalesce(m.last_error,'Backfilled from confirmed hard-bounce evidence'),
      coalesce(m.bounced_at,now())
    from messages m
    where m.status='bounced'
      and (
        exists (
          select 1
          from message_events e
          where e.message_id=m.id
            and e.type='postfix_bounced'
            and coalesce((e.payload->>'suppressRecipient')::boolean,false)=true
        )
        or lower(coalesce(m.last_error,'')) ~ '5\\.1\\.1|user unknown|unknown user|no such (user|mailbox)|mailbox (does not exist|not found)|recipient (does not exist|not found)'
      )
    on conflict(normalized_email) do nothing
  `);
  console.log(`[backfill-bounced-suppressions] inserted ${result.rowCount || 0} confirmed hard-bounce suppressions`);
}

main()
  .catch((error) => {
    console.error("[backfill-bounced-suppressions]", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
