-- Explicit installation only. One bot, automatic notifications only.
-- Does not activate mailings, create deliveries or change recipient data.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS noco.telegram_notification_pacing (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    next_send_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO noco.telegram_notification_pacing(singleton) VALUES(true)
ON CONFLICT(singleton) DO NOTHING;
REVOKE ALL ON noco.telegram_notification_pacing FROM PUBLIC;

CREATE OR REPLACE FUNCTION noco.telegram_notification_try_claim()
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $body$
DECLARE claimed boolean;
BEGIN
    UPDATE noco.telegram_notification_pacing
    SET next_send_at=clock_timestamp()+interval '5 seconds'
    WHERE singleton AND next_send_at<=clock_timestamp()
    RETURNING true INTO claimed;
    RETURN COALESCE(claimed,false);
END;
$body$;
REVOKE ALL ON FUNCTION noco.telegram_notification_try_claim() FROM PUBLIC;
DO $grants$
DECLARE app_role text;
BEGIN
    FOREACH app_role IN ARRAY ARRAY['unicorn_sql_app','crm_unicorn_app'] LOOP
        IF EXISTS(SELECT FROM pg_roles WHERE rolname=app_role) THEN
            EXECUTE format('REVOKE ALL ON noco.telegram_notification_pacing FROM %I',app_role);
            EXECUTE format('GRANT EXECUTE ON FUNCTION noco.telegram_notification_try_claim() TO %I',app_role);
        END IF;
    END LOOP;
END;
$grants$;
COMMIT;
