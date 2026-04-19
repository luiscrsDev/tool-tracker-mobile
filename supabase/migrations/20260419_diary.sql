CREATE TABLE IF NOT EXISTS diary_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   UUID REFERENCES contractors(id) ON DELETE CASCADE,
  event           TEXT NOT NULL CHECK (event IN ('departed', 'arrived', 'stopped', 'resumed')),
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_diary_contractor ON diary_entries(contractor_id, created_at DESC);

ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "diary_all" ON diary_entries FOR ALL USING (true) WITH CHECK (true);
