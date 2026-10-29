BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('public.jobsense_touch_version()') IS NULL
    OR to_regclass('public.jobsense_profiles') IS NULL THEN
    RAISE EXCEPTION 'The account foundation must exist first.';
  END IF;
  IF to_regclass('public.jobsense_resume_photos') IS NOT NULL THEN
    RAISE EXCEPTION 'Resume photo table already exists; do not rerun or drop existing photos.';
  END IF;
END
$guard$;

CREATE TABLE public.jobsense_resume_photos (
  user_id varchar(64) PRIMARY KEY DEFAULT auth.uid(),
  image_data text NOT NULL CHECK (
    length(image_data) <= 280000
    AND image_data ~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$'
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER jobsense_resume_photos_version BEFORE UPDATE ON public.jobsense_resume_photos
  FOR EACH ROW EXECUTE FUNCTION public.jobsense_touch_version();

ALTER TABLE public.jobsense_resume_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobsense_resume_photos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jobsense_resume_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jobsense_resume_photos TO authenticated;
GRANT INSERT (image_data) ON TABLE public.jobsense_resume_photos TO authenticated;
GRANT UPDATE (image_data) ON TABLE public.jobsense_resume_photos TO authenticated;

CREATE POLICY jobsense_resume_photos_read ON public.jobsense_resume_photos FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_resume_photos_create ON public.jobsense_resume_photos FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY jobsense_resume_photos_update ON public.jobsense_resume_photos FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
COMMIT;
