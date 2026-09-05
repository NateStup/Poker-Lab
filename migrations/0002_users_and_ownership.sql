-- Users, sessions, and real ownership of hands.
--
-- `users` and `sessions` are purpose-built tables with their own columns,
-- not another JSONB envelope through PostgresStore -- unlike `history` and
-- `tournaments`, which have no relationships to model, these two exist
-- entirely to be joined against (a hand to its owner, a session to its
-- user), and a JSONB blob has nothing to offer a table whose only job is
-- foreign keys. `id` generation stays in the application layer either way,
-- matching how every other table here already gets its id from
-- `randomUUID()` in JS rather than a database default -- one convention for
-- "how a row gets its id," not two.
--
-- `hands` changes from a table anyone with an id could read to a table only
-- its owner can reach by id at all. A hand's own id stops being a share
-- mechanism -- `share_token` is a second, independent identifier, generated
-- only when the owner chooses to share, and revocable by clearing it without
-- touching the hand itself. Existing rows in `hands` predate accounts
-- entirely and have no real owner to assign, so this migration clears them
-- rather than inventing one -- there is no real user data here to lose, only
-- local test hands logged before there was any such thing as a user.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  -- The session id itself is the bearer token, delivered as a signed
  -- httpOnly cookie -- there is no separate secret to look one up by. It is
  -- a random string, not a UUID, because it needs more entropy than a UUID's
  -- 122 random bits offer for something an attacker could try to guess over
  -- the network.
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- No real ownership existed before accounts did, so there is nothing to
-- carry forward -- see the note above.
DELETE FROM hands;

ALTER TABLE hands ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE hands ALTER COLUMN user_id SET NOT NULL;

-- NULL until the owner shares the hand; cleared to revoke without deleting
-- the hand. UNIQUE already gives this the index a token lookup needs, so
-- there is nothing further to add for that.
ALTER TABLE hands ADD COLUMN share_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS hands_user_id_idx ON hands (user_id);
