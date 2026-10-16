-- App-level AI provider credentials (single-user personal deployment).
-- Encrypted at rest with V2_AI_CREDENTIAL_KEY; never exported or backed up.
CREATE TABLE v2_ai_provider_credentials (
  provider text PRIMARY KEY NOT NULL CHECK (provider IN ('openai_plan')),
  status text NOT NULL CHECK (status IN ('active','inactive')),
  ciphertext text NOT NULL CHECK (length(ciphertext) > 0),
  iv text NOT NULL CHECK (length(iv) > 0),
  version integer NOT NULL CHECK (version >= 1),
  paused_until text,
  last_error_code text,
  updated_at text NOT NULL
);
