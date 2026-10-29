BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.jobsense_profiles') IS NULL
     OR to_regclass('public.jobsense_experiences') IS NULL
     OR to_regprocedure('public.jobsense_touch_version()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'Run the account foundation first; no changes made.';
  END IF;
  IF to_regclass('public.jobsense_documents') IS NOT NULL THEN
    RAISE EXCEPTION 'Text documents already exist; no changes made. Do not rerun or drop existing data.';
  END IF;
END
$guard$;

CREATE TABLE public.jobsense_documents (
  user_id varchar(64) NOT NULL DEFAULT auth.uid(),
  document_key varchar(20) NOT NULL CHECK (document_key IN ('applications', 'career', 'preferences')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 2000000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_key)
);

CREATE TRIGGER jobsense_documents_version BEFORE UPDATE ON public.jobsense_documents
  FOR EACH ROW EXECUTE FUNCTION public.jobsense_touch_version();

ALTER TABLE public.jobsense_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobsense_documents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jobsense_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jobsense_documents TO authenticated;
GRANT INSERT (document_key, content) ON TABLE public.jobsense_documents TO authenticated;
GRANT UPDATE (content) ON TABLE public.jobsense_documents TO authenticated;

CREATE POLICY jobsense_documents_read ON public.jobsense_documents FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_documents_create ON public.jobsense_documents FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_documents_update ON public.jobsense_documents FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
