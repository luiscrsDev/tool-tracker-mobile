-- Add ibeacon_id column to tags table for iOS iBeacon background detection
-- Format: "MAJOR:MINOR" (e.g. "1:1", "1:2")

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS ibeacon_id TEXT;

-- Populate known tags (M1P iBeacon config set via MokoBeacon X)
-- Parafusadeira: MAC E4:06:BF:C1:37:9B → Major 1 Minor 1
UPDATE tags SET ibeacon_id = '1:1' WHERE tag_id = 'E4:06:BF:C1:37:9B';

-- Novo: Major 1 Minor 2 (update tag_id below when MAC is confirmed)
-- UPDATE tags SET ibeacon_id = '1:2' WHERE tag_id = '<MAC_DO_NOVO>';
