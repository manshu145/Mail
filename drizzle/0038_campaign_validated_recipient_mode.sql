ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_only_validated boolean NOT NULL DEFAULT false;
