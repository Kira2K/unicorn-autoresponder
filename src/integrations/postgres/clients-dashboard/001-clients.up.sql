-- TAS-143. Prepared locally only. Run in an explicitly approved transaction.
-- No client status backfill, account reassignment, task changes, or sends.
BEGIN;
ALTER TABLE noco.clients ADD COLUMN IF NOT EXISTS comments text;
ALTER TABLE noco.clients ADD COLUMN IF NOT EXISTS tg_hard_mentor text;
ALTER TABLE noco.clients ADD COLUMN IF NOT EXISTS tg_soft_mentor text;

CREATE TABLE IF NOT EXISTS noco.client_notification_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    activated_at timestamptz NOT NULL,
    status_cursor bigint NOT NULL
);
-- Intentionally no initial activation row. Enabling is a separate explicit action.
CREATE TABLE IF NOT EXISTS noco.client_notifications (
    event_key text PRIMARY KEY,
    client_id bigint NOT NULL,
    kind text NOT NULL,
    points jsonb NOT NULL DEFAULT '[]'::jsonb,
    attempted_at timestamptz NOT NULL,
    outcome text NOT NULL DEFAULT 'claimed' CHECK (outcome IN ('claimed','sent','failed','uncertain')),
    message_id bigint,
    error_code text
);
CREATE INDEX IF NOT EXISTS client_notifications_client_time ON noco.client_notifications(client_id, attempted_at DESC);
ALTER TABLE noco.client_notifications ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE noco.client_notifications ADD COLUMN IF NOT EXISTS retry_at timestamptz;
-- Per-event receipts, not an ID high-water mark: sequence allocation is not commit order.
CREATE TABLE IF NOT EXISTS noco.client_notification_events (
    history_id bigint PRIMARY KEY,
    done boolean NOT NULL,
    retry_at timestamptz
);
-- A started daily check survives a slow batch, SQL outage or process restart.
CREATE TABLE IF NOT EXISTS noco.client_notification_days (
    scheduled_at timestamptz PRIMARY KEY,
    done boolean NOT NULL DEFAULT false
);
-- The existing application login, never PUBLIC/owner, owns delivery operations.
-- Clients permissions are unchanged; history is read through five columns only.
-- No DELETE/DDL rights are added.
GRANT SELECT, INSERT, UPDATE ON
    noco.client_notification_state, noco.client_notifications,
    noco.client_notification_events, noco.client_notification_days
TO unicorn_sql_app;
GRANT SELECT (id, client_id, old_status, new_status, changed_at)
ON noco.client_status_history TO unicorn_sql_app;
-- A durable claim with an unknown delivery is not automatically retried.

CREATE OR REPLACE FUNCTION noco.client_account_indicators(p_client_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $body$
WITH client AS (
    SELECT market_id FROM noco.clients WHERE id=p_client_id
), kinds(kind, foreign_only) AS (
    VALUES ('phone_en',true),('phone_ru',false),('hh_en',true),('hh_ru',false),('linkedin',true),
           ('telegram_en',true),('telegram_ru',false),('email_en',true),('email_ru',false)
), present AS (
    -- Canonical type is platforms.label (e.g. name=phone, label=phone_en).
    SELECT lower(btrim(p.label)) AS kind
    FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
    WHERE a.clients_id=p_client_id AND NOT COALESCE(a.__nc_deleted,false)
      AND (NULLIF(btrim(a.login),'') IS NOT NULL OR NULLIF(btrim(a.phone),'') IS NOT NULL)
)
SELECT jsonb_object_agg(kind, CASE
    WHEN c.market_id IS NULL OR c.market_id NOT IN (1,2,3) THEN 'маркет не указан'
    WHEN c.market_id=1 AND foreign_only THEN 'не применимо'
    WHEN EXISTS(SELECT 1 FROM present p WHERE p.kind=k.kind) THEN 'заполнен'
    ELSE 'не заполнен' END)
FROM kinds k CROSS JOIN client c;
$body$;

CREATE OR REPLACE FUNCTION noco.client_dashboard_statuses(p_client_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $body$
SELECT jsonb_build_object(
    'resume_status', CASE WHEN cv.n=0 THEN 'нет записи' WHEN cv.n=1 THEN cv.status ELSE 'несколько записей' END,
    'linkedin_status', CASE WHEN ll.n=1 THEN ll.status WHEN ll.n>1 THEN 'несколько записей'
        WHEN c.market_id=1 THEN 'не применимо' ELSE NULL END
)
FROM noco.clients c
CROSS JOIN LATERAL (SELECT count(*) n, min(status) status FROM noco."CV processing" v
    WHERE v.clients_id=c.id AND NOT COALESCE(v.__nc_deleted,false)) cv
CROSS JOIN LATERAL (SELECT count(*) n, min(status) status FROM noco.linklab l WHERE l.client_id=c.id) ll
WHERE c.id=p_client_id;
$body$;

COMMIT;
