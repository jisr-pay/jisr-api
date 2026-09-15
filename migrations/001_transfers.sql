CREATE TABLE transfers (
  network TEXT NOT NULL CHECK (network = 'TESTNET'),
  hash TEXT NOT NULL CHECK (length(hash) = 64),
  identity_json TEXT NOT NULL CHECK (json_valid(identity_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  settlement_json TEXT CHECK (settlement_json IS NULL OR json_valid(settlement_json)),
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (network, hash)
) STRICT;
