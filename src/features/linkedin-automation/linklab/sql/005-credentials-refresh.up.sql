-- Refresh the auxiliary warning in LinkLab's worker, not in account saves.
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP TRIGGER linklab_credentials_changed ON noco.platform_accounts;

CREATE FUNCTION noco.linklab_refresh_credentials() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE changed bigint;
BEGIN
  UPDATE noco.linklab l SET credentials_issue = source.issue
  FROM (
    SELECT linked.client_id, linked.platform_account_id,
      CASE WHEN a.id IS NULL OR COALESCE(a.__nc_deleted,false)
        THEN 'linkedin_account_missing'
        WHEN NOT COALESCE(a.login ~ '[^[:space:]]' AND a.password ~ '[^[:space:]]',false)
        THEN 'linkedin_credentials_incomplete' END AS issue
    FROM noco.linklab linked
    LEFT JOIN noco.platform_accounts a ON a.id = linked.platform_account_id
  ) source
  WHERE l.client_id = source.client_id
    AND l.platform_account_id IS NOT DISTINCT FROM source.platform_account_id
    AND l.credentials_issue IS DISTINCT FROM source.issue;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION noco.linklab_refresh_credentials() FROM PUBLIC;
COMMIT;
