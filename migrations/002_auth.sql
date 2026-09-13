CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX auth_challenges_address ON auth_challenges(address);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX transfers_sender_hash ON transfers(json_extract(identity_json, '$.sender'), hash);
