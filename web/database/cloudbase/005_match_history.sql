BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.jobsense_profiles') IS NULL OR to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'Run the account foundation first; no changes made.';
  END IF;
  IF to_regclass('public.jobsense_match_history') IS NOT NULL
     OR to_regprocedure('public.jobsense_save_match_history(uuid,text,jsonb,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'Match history already exists; do not rerun or drop existing records.';
  END IF;
  -- Existing profile rows FORCE RLS. The trusted migration/function owner must
  -- be able to lock these rows independently of application-role membership.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Run this migration as the database administrator with BYPASSRLS; no changes made.';
  END IF;
END
$guard$;

CREATE TABLE public.jobsense_match_history (
  user_id varchar(64) NOT NULL DEFAULT auth.uid(),
  id uuid NOT NULL,
  title varchar(120) NOT NULL CHECK (length(btrim(title)) > 0 AND title !~ '[[:cntrl:]]'),
  original_snapshot jsonb NOT NULL,
  current_snapshot jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, id),
  CHECK (jsonb_typeof(original_snapshot) = 'object' AND octet_length(original_snapshot::text) <= 2000000),
  CHECK (jsonb_typeof(current_snapshot) = 'object' AND octet_length(current_snapshot::text) <= 2000000)
);
CREATE INDEX jobsense_history_recent ON public.jobsense_match_history(user_id, created_at DESC, id DESC);
ALTER TABLE public.jobsense_match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobsense_match_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jobsense_match_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jobsense_match_history TO authenticated;
CREATE POLICY jobsense_history_read ON public.jobsense_match_history FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- All mutations pass through this transaction. Clients cannot set ownership,
-- original snapshot, version, or timestamps, and cannot bypass retention.
CREATE FUNCTION public.jobsense_save_match_history(p_id uuid, p_title text, p_snapshot jsonb, p_expected_version bigint)
RETURNS SETOF public.jobsense_match_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  who text := auth.uid();
  previous public.jobsense_match_history%ROWTYPE;
  instant timestamptz;
  photo text;
BEGIN
  IF who IS NULL OR who = '' THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF p_id IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR p_title ~ '[[:cntrl:]]'
     OR (p_expected_version IS NOT NULL AND p_expected_version < 1) THEN
    RAISE EXCEPTION 'Invalid history metadata' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR octet_length(p_snapshot::text) > 2000000
     OR jsonb_typeof(p_snapshot->'draft') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'typography') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'photoDataUrl') IS DISTINCT FROM 'string'
     OR (p_snapshot - ARRAY['draft','typography','photoDataUrl']) <> '{}'::jsonb
     OR p_snapshot->'draft'->'generated' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(p_snapshot->'draft'->'matchedJob') IS DISTINCT FROM 'string'
     OR length(btrim(p_snapshot->'draft'->>'matchedJob')) NOT BETWEEN 10 AND 16000
     OR jsonb_typeof(p_snapshot->'draft'->'jobText') IS DISTINCT FROM 'string'
     OR btrim(p_snapshot->'draft'->>'jobText') IS DISTINCT FROM p_snapshot->'draft'->>'matchedJob'
     OR ((p_snapshot->'draft' ? 'resumeJob') AND p_snapshot->'draft'->'resumeJob' IS DISTINCT FROM p_snapshot->'draft'->'matchedJob')
     OR p_snapshot->'draft'->'matchRevision' IS DISTINCT FROM p_snapshot->'draft'->'resumeMatchRevision'
     OR jsonb_typeof(p_snapshot->'draft'->'sections') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'draft'->'results') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot->'draft'->'selectedIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid history snapshot' USING ERRCODE = '22023';
  END IF;
  photo := p_snapshot->>'photoDataUrl';
  IF photo <> '' AND (length(photo) > 262167 OR photo !~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$') THEN
    RAISE EXCEPTION 'Invalid history photo' USING ERRCODE = '22023';
  END IF;
  -- Serialize writes for the same authenticated account, including two first
  -- inserts. The row lock lives only for this short SQL transaction.
  PERFORM 1 FROM public.jobsense_profiles AS p WHERE p.user_id = who FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account profile required' USING ERRCODE = '42501'; END IF;
  SELECT h.* INTO previous FROM public.jobsense_match_history AS h WHERE h.user_id = who AND h.id = p_id;
  IF FOUND THEN
    IF p_expected_version IS NULL THEN
      -- A lost create response may be retried, but an edited record cannot be
      -- overwritten or mistaken for this initial create.
      IF previous.title IS DISTINCT FROM btrim(p_title) OR previous.original_snapshot IS DISTINCT FROM p_snapshot
         OR previous.current_snapshot IS DISTINCT FROM p_snapshot THEN
        RAISE EXCEPTION 'History create conflict' USING ERRCODE = '23505';
      END IF;
    ELSIF previous.title = btrim(p_title) AND previous.current_snapshot = p_snapshot THEN
      NULL; -- Idempotent retry after a lost update response.
    ELSIF previous.version <> p_expected_version THEN
      RAISE EXCEPTION 'History version conflict' USING ERRCODE = '23505';
    ELSE
      UPDATE public.jobsense_match_history AS h SET title = btrim(p_title), current_snapshot = p_snapshot,
        version = h.version + 1, updated_at = clock_timestamp() WHERE h.user_id = who AND h.id = p_id;
    END IF;
  ELSE
    IF p_expected_version IS NOT NULL THEN
      RAISE EXCEPTION 'History was removed by retention' USING ERRCODE = '23505';
    END IF;
    instant := clock_timestamp();
    INSERT INTO public.jobsense_match_history(user_id, id, title, original_snapshot, current_snapshot, created_at, updated_at)
      VALUES (who, p_id, btrim(p_title), p_snapshot, p_snapshot, instant, instant);
    DELETE FROM public.jobsense_match_history AS h WHERE h.user_id = who AND h.id IN (
      SELECT older.id FROM public.jobsense_match_history AS older WHERE older.user_id = who
      ORDER BY older.created_at DESC, older.id DESC OFFSET 30
    );
  END IF;
  RETURN QUERY SELECT h.* FROM public.jobsense_match_history AS h WHERE h.user_id = who AND h.id = p_id;
END
$function$;

REVOKE ALL ON FUNCTION public.jobsense_save_match_history(uuid,text,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jobsense_save_match_history(uuid,text,jsonb,bigint) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
