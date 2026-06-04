-- detected_by was scoped to app_users via FK, which broke crowd-source posts
-- whenever the logged-in user is a contractor or admin (they live in different
-- tables). Drop the FK so detected_by can hold any user id from any role table.
-- We keep the column as uuid for indexability; integrity is enforced at the
-- application layer (AuthContext only passes ids that exist).

ALTER TABLE public.tool_movements
  DROP CONSTRAINT IF EXISTS tool_movements_detected_by_fkey;

COMMENT ON COLUMN public.tool_movements.detected_by IS
  'Id of the user (worker/contractor/admin) whose Locate-Tool app physically '
  'detected this tag advertisement. No FK because users live in 3 separate '
  'tables (app_users / contractors / admin_users) — the value should be looked '
  'up by trying each table in order.';
