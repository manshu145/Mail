CREATE TABLE postfix_log_checkpoints (
  file_key text PRIMARY KEY,
  byte_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE postfix_log_inbox (
  id bigserial PRIMARY KEY,
  file_key text NOT NULL,
  line_key text NOT NULL,
  queue_id text NOT NULL,
  message_id uuid,
  outcome text,
  raw_line text NOT NULL,
  processed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(file_key,line_key)
);
--> statement-breakpoint
CREATE INDEX postfix_log_pending_idx ON postfix_log_inbox(next_attempt_at,id) WHERE outcome IS NOT NULL AND processed_at IS NULL;
--> statement-breakpoint
CREATE INDEX postfix_log_mapping_idx ON postfix_log_inbox(queue_id,id DESC) WHERE message_id IS NOT NULL;
