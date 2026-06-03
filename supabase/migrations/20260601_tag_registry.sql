-- Global tag registry for crowd-sourced BLE detection.
--
-- Any authenticated LocateTool client (Android or iOS) reads this view to
-- learn every active tag in the network, so it can detect tools owned by
-- *other* users that pass within BLE range and report their location via
-- tool_movements.detected_by.
--
-- View vs table: a view stays auto-synced with tools/tags changes; no
-- triggers needed. RLS on the view is inherited from the underlying tables,
-- so we expose the JOIN through a SECURITY DEFINER function that bypasses
-- the per-contractor RLS on tools/tags and returns only the columns the BLE
-- service needs (no value, battery, images, etc.).

CREATE OR REPLACE FUNCTION public.bletracker_registry()
RETURNS TABLE (
  mac          text,
  ibeacon_id   text,
  tool_id      uuid,
  tool_name    text,
  contractor_id uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    upper(t.tag_id)      AS mac,
    t.ibeacon_id         AS ibeacon_id,
    tl.id                AS tool_id,
    tl.name              AS tool_name,
    tl.contractor_id
  FROM public.tags t
  JOIN public.tools tl ON tl.assigned_tag = t.id
  WHERE t.status  = 'active'
    AND tl.status = 'active'
    AND t.tag_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.bletracker_registry() TO anon, authenticated;

COMMENT ON FUNCTION public.bletracker_registry() IS
  'Returns every active (tag, tool) pairing across all contractors. Used by '
  'the BLE tracker service to crowd-source tool detection — any logged-in '
  'app can detect any tool and report it back via tool_movements.detected_by.';

-- detected_by column already exists in tool_movements (see initial schema).
-- We just need clients to populate it.
