-- Settings only. No working values, automatic activation, or external sends.
BEGIN;
CREATE TABLE IF NOT EXISTS noco.client_notification_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    instructions_url text NOT NULL CHECK (btrim(instructions_url) <> ''),
    hh_instructions_url text NOT NULL CHECK (btrim(hh_instructions_url) <> ''),
    cabinet_url text NOT NULL CHECK (btrim(cabinet_url) <> ''),
    cabinet_password text NOT NULL CHECK (btrim(cabinet_password) <> ''),
    support_tag text NOT NULL CHECK (support_tag ~ '^@[A-Za-z0-9_]{5,32}$'),
    support_chat_id text NOT NULL CHECK (support_chat_id ~ '^-?[1-9][0-9]*$')
);
-- A privileged operator supplies the single row separately. The application reads only.
REVOKE ALL ON noco.client_notification_settings FROM PUBLIC;
-- Do not inherit broad UI/default grants on this table containing message credentials.
DO $permissions$
DECLARE grantee_name text;
BEGIN
    FOR grantee_name IN
        SELECT DISTINCT pg_get_userbyid(a.grantee)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname='noco' AND c.relname='client_notification_settings'
          AND a.grantee<>0 AND a.grantee<>c.relowner
    LOOP
        EXECUTE format('REVOKE ALL ON noco.client_notification_settings FROM %I', grantee_name);
    END LOOP;
END
$permissions$;
GRANT SELECT ON noco.client_notification_settings TO unicorn_sql_app;
COMMIT;
