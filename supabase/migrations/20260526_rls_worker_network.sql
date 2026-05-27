-- Enable RLS on worker network tables (fixes Supabase security alert)
-- Context: app uses custom phone OTP (no Supabase Auth JWT), anon key queries tables directly.
-- otp_codes accessed only via Edge Functions (service_role bypasses RLS).

-- otp_codes: service_role only — no anon access needed (Edge Functions handle all OTP ops)
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- app_users: anon SELECT (role detection on login) + INSERT (new worker registration)
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_users_select"
  ON app_users FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "app_users_insert"
  ON app_users FOR INSERT
  TO anon
  WITH CHECK (true);

-- contractor_users: anon SELECT (relationship lookups)
ALTER TABLE contractor_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contractor_users_select"
  ON contractor_users FOR SELECT
  TO anon
  USING (true);

-- tool_transfers: anon SELECT + INSERT + UPDATE (transfer flow in app)
ALTER TABLE tool_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tool_transfers_select"
  ON tool_transfers FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "tool_transfers_insert"
  ON tool_transfers FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "tool_transfers_update"
  ON tool_transfers FOR UPDATE
  TO anon
  USING (true);
