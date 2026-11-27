\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS name, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND pg_get_userbyid(c.relowner) = 'university_app'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO postgres',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.name);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'university_app'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.name);
  END LOOP;
END $$;
ALTER DATABASE ocp_java OWNER TO postgres;
DROP OWNED BY university_app;
DROP ROLE university_app;
COMMIT;
