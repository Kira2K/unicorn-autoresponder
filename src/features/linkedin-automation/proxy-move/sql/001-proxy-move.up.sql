CREATE TABLE IF NOT EXISTS noco.linkedin_proxy_move (
  id uuid PRIMARY KEY, client_id bigint NOT NULL REFERENCES noco.clients(id),
  account_id bigint NOT NULL REFERENCES noco.platform_accounts(id),
  profile_id bigint REFERENCES noco.octo_profiles(profile_id) ON DELETE SET NULL,
  data jsonb NOT NULL, notice_state text NOT NULL DEFAULT 'none'
    CHECK(notice_state IN ('none','pending','attempting','sent','failed','uncertain')),
  claim_token uuid, claimed_at timestamptz, message_id bigint, error_code text,
  UNIQUE(client_id,account_id)
);
REVOKE ALL ON noco.linkedin_proxy_move FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON noco.linkedin_proxy_move TO unicorn_sql_app;
