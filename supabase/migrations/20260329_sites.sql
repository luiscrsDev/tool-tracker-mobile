-- Sites: pre-defined locations with labels
CREATE TABLE IF NOT EXISTS sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  radius_m      INT DEFAULT 100,
  address       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS disabled for now (same as tags)
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sites_all" ON sites FOR ALL USING (true) WITH CHECK (true);
