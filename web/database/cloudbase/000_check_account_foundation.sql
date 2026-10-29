SELECT
  to_regclass('public.jobsense_profiles') IS NOT NULL AS jobsense_profiles_exists,
  to_regclass('public.jobsense_experiences') IS NOT NULL AS jobsense_experiences_exists,
  (
    SELECT format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute AS a
    JOIN pg_class AS c ON c.oid = a.attrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND a.attname = 'id'
      AND NOT a.attisdropped
  ) AS auth_users_id_type;
