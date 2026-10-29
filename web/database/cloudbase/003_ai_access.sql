BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.jobsense_profiles') IS NULL
    OR to_regclass('public.jobsense_experiences') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'The account foundation must exist first; nothing was created.';
  END IF;
  IF to_regnamespace('jobsense_ai_private') IS NOT NULL
    OR to_regprocedure('public.jobsense_ai_reserve()') IS NOT NULL
    OR to_regprocedure('public.jobsense_ai_release(uuid)') IS NOT NULL
    OR to_regprocedure('public.jobsense_ai_budget_status()') IS NOT NULL THEN
    RAISE EXCEPTION 'AI access objects already exist; review the migration instead of rerunning it.';
  END IF;
END
$guard$;

CREATE SCHEMA jobsense_ai_private;
REVOKE ALL ON SCHEMA jobsense_ai_private FROM PUBLIC, anon, authenticated;

CREATE TABLE jobsense_ai_private.usage (
  user_id text PRIMARY KEY,
  call_times timestamptz[] NOT NULL DEFAULT '{}',
  usage_day date NOT NULL,
  daily_count integer NOT NULL DEFAULT 0 CHECK (daily_count BETWEEN 0 AND 50),
  lease_id uuid,
  lease_until timestamptz
);
ALTER TABLE jobsense_ai_private.usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE jobsense_ai_private.usage FROM PUBLIC, anon, authenticated;

-- Only the function owner can access this private table. No direct API policy
-- or client table grant exists; functions derive ownership from auth.uid().
CREATE FUNCTION public.jobsense_ai_budget_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  who text := auth.uid();
  today date := (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date;
  used integer;
BEGIN
  IF who IS NULL OR who = '' THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT CASE WHEN u.usage_day = today THEN u.daily_count ELSE 0 END INTO used
    FROM jobsense_ai_private.usage AS u WHERE u.user_id = who;
  RETURN jsonb_build_object('user_id', who, 'daily_limit', 50, 'window_limit', 12,
    'remaining_today', 50 - coalesce(used, 0));
END
$function$;

CREATE FUNCTION public.jobsense_ai_reserve() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  who text := auth.uid();
  instant timestamptz := clock_timestamp();
  today date := (instant AT TIME ZONE 'Asia/Shanghai')::date;
  state jobsense_ai_private.usage%ROWTYPE;
  recent timestamptz[];
  next_lease uuid;
BEGIN
  IF who IS NULL OR who = '' THEN RAISE EXCEPTION 'Authentication required'; END IF;
  INSERT INTO jobsense_ai_private.usage (user_id, usage_day) VALUES (who, today)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT u.* INTO state FROM jobsense_ai_private.usage AS u WHERE u.user_id = who FOR UPDATE;
  instant := clock_timestamp();
  today := (instant AT TIME ZONE 'Asia/Shanghai')::date;
  SELECT coalesce(array_agg(c.t), '{}'::timestamptz[]) INTO recent FROM unnest(state.call_times) AS c(t)
    WHERE c.t > instant - interval '10 minutes';
  IF state.usage_day <> today THEN state.daily_count := 0; END IF;
  IF state.lease_until > instant THEN RETURN jsonb_build_object('allowed', false, 'reason', 'busy'); END IF;
  IF state.daily_count >= 50 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'daily'); END IF;
  IF cardinality(recent) >= 12 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'window'); END IF;
  next_lease := gen_random_uuid();
  UPDATE jobsense_ai_private.usage AS u SET usage_day = today, daily_count = state.daily_count + 1,
    call_times = array_append(recent, instant), lease_id = next_lease, lease_until = instant + interval '110 seconds'
    WHERE u.user_id = who;
  RETURN jsonb_build_object('allowed', true, 'lease_id', next_lease);
END
$function$;

CREATE FUNCTION public.jobsense_ai_release(p_lease_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE who text := auth.uid();
BEGIN
  IF who IS NULL OR who = '' THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE jobsense_ai_private.usage AS u SET lease_id = NULL, lease_until = NULL
    WHERE u.user_id = who AND u.lease_id = p_lease_id;
END
$function$;

REVOKE ALL ON FUNCTION public.jobsense_ai_budget_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobsense_ai_reserve() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobsense_ai_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jobsense_ai_budget_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jobsense_ai_reserve() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jobsense_ai_release(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT user_id AS ai_user_id, display_name FROM public.jobsense_profiles;
