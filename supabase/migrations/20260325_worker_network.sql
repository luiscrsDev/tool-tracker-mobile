-- ============================================
-- LocateTool — Worker Network Migration
-- ============================================

-- 1. Phone on contractors
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;

-- 2. Independent workers (app_users)
CREATE TABLE IF NOT EXISTS app_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  phone       TEXT UNIQUE NOT NULL,
  dob         DATE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Worker ↔ Contractor relationship (N:N)
CREATE TABLE IF NOT EXISTS contractor_users (
  contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
  app_user_id   UUID REFERENCES app_users(id)   ON DELETE CASCADE,
  role          TEXT DEFAULT 'responsible',
  added_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (contractor_id, app_user_id)
);

-- 4. Chain of custody — tool transfers
CREATE TABLE IF NOT EXISTS tool_transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id       UUID REFERENCES tools(id) ON DELETE CASCADE,
  from_user_id  UUID REFERENCES app_users(id),
  to_user_id    UUID REFERENCES app_users(id),
  status        TEXT DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected')),
  message       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  responded_at  TIMESTAMPTZ
);

-- 5. Current responsible on each tool
ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS current_responsible_id UUID REFERENCES app_users(id);

-- 6. Enrich location_history
ALTER TABLE location_history
  ADD COLUMN IF NOT EXISTS contractor_id        UUID REFERENCES contractors(id),
  ADD COLUMN IF NOT EXISTS reported_by_user_id  UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS responsible_user_id  UUID REFERENCES app_users(id),
  ADD COLUMN IF NOT EXISTS detection_method     TEXT DEFAULT 'gps_active'
    CHECK (detection_method IN ('gps_active', 'ble_relay'));

-- 7. OTP codes (SMS verification — phone agnostic)
CREATE TABLE IF NOT EXISTS otp_codes (
  phone       TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT DEFAULT 0
);

-- 8. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_tool_transfers_to_user
  ON tool_transfers(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tool_transfers_tool
  ON tool_transfers(tool_id);
CREATE INDEX IF NOT EXISTS idx_location_history_contractor
  ON location_history(contractor_id);
