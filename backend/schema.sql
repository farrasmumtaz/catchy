BEGIN;
SELECT pg_advisory_xact_lock(713491052);
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  username varchar(32) UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions(expires_at);
CREATE TABLE IF NOT EXISTS chat_messages (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES app_users(id),
  recipient_id uuid NOT NULL REFERENCES app_users(id),
  client_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000 AND length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS chat_messages_pair ON chat_messages(sender_id, recipient_id, id DESC);
CREATE INDEX IF NOT EXISTS chat_messages_recipient ON chat_messages(recipient_id, id DESC);
COMMIT;
