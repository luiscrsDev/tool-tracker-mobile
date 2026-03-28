-- ============================================
-- Tags Table — Separate BLE tracker registry
-- ============================================

-- 1. Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  tag_id        TEXT UNIQUE NOT NULL,   -- BLE identifier (MAC or manufacturer data)
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  battery       INT,
  paired_at     TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Add assigned_tag FK on tools
ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS assigned_tag UUID REFERENCES tags(id) ON DELETE SET NULL;

-- 3. Migrate existing data: tools with tag_id → insert into tags + set assigned_tag
DO $$
DECLARE
  r RECORD;
  new_tag_id UUID;
BEGIN
  FOR r IN SELECT id, contractor_id, tag_id, tag_name FROM tools WHERE tag_id IS NOT NULL
  LOOP
    -- Skip if tag already migrated
    IF NOT EXISTS (SELECT 1 FROM tags WHERE tag_id = r.tag_id) THEN
      INSERT INTO tags (contractor_id, name, tag_id)
      VALUES (r.contractor_id, COALESCE(r.tag_name, 'Tag'), r.tag_id)
      RETURNING id INTO new_tag_id;
    ELSE
      SELECT id INTO new_tag_id FROM tags WHERE tag_id = r.tag_id;
    END IF;

    UPDATE tools SET assigned_tag = new_tag_id WHERE id = r.id;
  END LOOP;
END $$;

-- 4. Drop old columns from tools
ALTER TABLE tools
  DROP COLUMN IF EXISTS tag_id,
  DROP COLUMN IF EXISTS tag_name,
  DROP COLUMN IF EXISTS is_connected;

-- 5. RLS for tags (same as tools — contractor can see their own)
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view own tags"
  ON tags FOR SELECT
  USING (contractor_id = auth.uid());

CREATE POLICY "Contractors can insert own tags"
  ON tags FOR INSERT
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can update own tags"
  ON tags FOR UPDATE
  USING (contractor_id = auth.uid());

CREATE POLICY "Contractors can delete own tags"
  ON tags FOR DELETE
  USING (contractor_id = auth.uid());
