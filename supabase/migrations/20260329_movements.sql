-- Tool checkouts: which tools a worker took out
CREATE TABLE IF NOT EXISTS tool_checkouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id       UUID REFERENCES app_users(id),
  contractor_id   UUID REFERENCES contractors(id) ON DELETE CASCADE,
  tool_ids        UUID[] NOT NULL,
  site_id         UUID REFERENCES sites(id),
  checked_out_at  TIMESTAMPTZ DEFAULT now(),
  returned_at     TIMESTAMPTZ
);

ALTER TABLE tool_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkouts_all" ON tool_checkouts FOR ALL USING (true) WITH CHECK (true);

-- Tool movements: smart tracking records
CREATE TABLE IF NOT EXISTS tool_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id         UUID REFERENCES tools(id) ON DELETE CASCADE,
  contractor_id   UUID REFERENCES contractors(id) ON DELETE CASCADE,
  checkout_id     UUID REFERENCES tool_checkouts(id),
  event           TEXT NOT NULL CHECK (event IN ('movement', 'stop', 'speed', 'checkout')),
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  address         TEXT,
  site_id         UUID REFERENCES sites(id),
  speed_kmh       DOUBLE PRECISION,
  detected_by     UUID REFERENCES app_users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_movements_tool ON tool_movements(tool_id, created_at DESC);
CREATE INDEX idx_movements_checkout ON tool_movements(checkout_id);

ALTER TABLE tool_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements_all" ON tool_movements FOR ALL USING (true) WITH CHECK (true);
