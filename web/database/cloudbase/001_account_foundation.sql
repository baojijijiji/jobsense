BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'CloudBase PostgreSQL authentication is not available; nothing was created.';
  END IF;
  IF pg_typeof(auth.uid())::text NOT IN ('text', 'character varying') THEN
    RAISE EXCEPTION 'This script requires the CloudBase text user ID model; nothing was created.';
  END IF;
  IF to_regclass('public.jobsense_profiles') IS NOT NULL
     OR to_regclass('public.jobsense_experiences') IS NOT NULL
     OR to_regprocedure('public.jobsense_touch_version()') IS NOT NULL THEN
    RAISE EXCEPTION 'JobSense objects already exist; review migration history instead of overwriting them.';
  END IF;
END
$guard$;

CREATE TABLE public.jobsense_profiles (
  user_id varchar(64) PRIMARY KEY DEFAULT auth.uid(),
  display_name varchar(100) NOT NULL DEFAULT '',
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.jobsense_experiences (
  user_id varchar(64) NOT NULL DEFAULT auth.uid(),
  id varchar(100) NOT NULL CHECK (length(btrim(id)) > 0),
  title varchar(150) NOT NULL CHECK (length(btrim(title)) > 0),
  type varchar(10) NOT NULL CHECK (type IN ('教育', '科研', '项目', '实习', '实践')),
  period varchar(100) NOT NULL DEFAULT '',
  location varchar(100) NOT NULL DEFAULT '',
  organization varchar(200) NOT NULL DEFAULT '',
  role varchar(120) NOT NULL DEFAULT '',
  summary varchar(10000) NOT NULL DEFAULT '',
  outcome varchar(10000) NOT NULL DEFAULT '',
  skills varchar(60)[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 30 AND array_position(skills, NULL) IS NULL),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, id),
  CHECK (type = '教育' OR length(btrim(summary)) > 0)
);

CREATE INDEX jobsense_experiences_owner_updated ON public.jobsense_experiences(user_id, updated_at DESC);

CREATE FUNCTION public.jobsense_touch_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $version$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$version$;

CREATE TRIGGER jobsense_profiles_version BEFORE UPDATE ON public.jobsense_profiles
  FOR EACH ROW EXECUTE FUNCTION public.jobsense_touch_version();
CREATE TRIGGER jobsense_experiences_version BEFORE UPDATE ON public.jobsense_experiences
  FOR EACH ROW EXECUTE FUNCTION public.jobsense_touch_version();

ALTER TABLE public.jobsense_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobsense_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jobsense_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobsense_experiences FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.jobsense_profiles, public.jobsense_experiences FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.jobsense_profiles, public.jobsense_experiences TO authenticated;
GRANT INSERT (display_name) ON TABLE public.jobsense_profiles TO authenticated;
GRANT UPDATE (display_name) ON TABLE public.jobsense_profiles TO authenticated;
GRANT INSERT (id, title, type, period, location, organization, role, summary, outcome, skills, created_at, updated_at, deleted_at)
  ON TABLE public.jobsense_experiences TO authenticated;
GRANT UPDATE (title, type, period, location, organization, role, summary, outcome, skills, deleted_at)
  ON TABLE public.jobsense_experiences TO authenticated;

CREATE POLICY jobsense_profiles_read ON public.jobsense_profiles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_profiles_create ON public.jobsense_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_profiles_update ON public.jobsense_profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY jobsense_experiences_read ON public.jobsense_experiences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_experiences_create ON public.jobsense_experiences FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_experiences_update ON public.jobsense_experiences FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
