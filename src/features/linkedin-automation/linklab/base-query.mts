/** Read-only LinkLab projection. Credentials are tested in SQL, never returned. */
export const linkLabBaseQuery = `WITH candidates AS (
  SELECT a.id, a.clients_id, a.url,
    COALESCE(a.login ~ '[^[:space:]]' AND a.password ~ '[^[:space:]]', false) AS ready,
    COALESCE(btrim(a.url) ~* '^(https?://)?(www[.])?linkedin[.]com/in/[^/?#[:space:]]+([/?#][^[:space:]]*)?$', false) AS has_link
  FROM noco.platform_accounts a
  JOIN noco.platforms p ON p.id = a.platforms_id
  WHERE p.id = 16 AND lower(p.name) = 'linkedin'
    AND NOT COALESCE(p.__nc_deleted, false)
    AND NOT COALESCE(a.__nc_deleted, false)
), accounts AS (
  SELECT clients_id, count(*) AS account_count, count(*) FILTER(WHERE has_link) AS linked_count,
    min(id) AS account_id, min(url) AS url, bool_or(ready) AS ready,
    min(id) FILTER(WHERE has_link) AS linked_id, min(url) FILTER(WHERE has_link) AS linked_url,
    bool_or(ready) FILTER(WHERE has_link) AS linked_ready
  FROM candidates GROUP BY clients_id
)
SELECT c.id AS client_id, c.client_name,
  s.id AS stack_id, s.name AS stack,
  CASE WHEN a.linked_count = 1 THEN a.linked_id WHEN a.account_count = 1 THEN a.account_id END AS platform_account_id,
  CASE WHEN a.linked_count = 1 THEN a.linked_url WHEN a.account_count = 1 THEN a.url END AS linkedin_url,
  CASE WHEN a.account_count > 1 AND a.linked_count <> 1 THEN 'linkedin_account_ambiguous' END AS data_issue
FROM noco.clients c
JOIN accounts a ON a.clients_id = c.id AND CASE WHEN a.linked_count = 1 THEN a.linked_ready ELSE a.ready END
LEFT JOIN noco.stacks s ON s.id = c."01_stacks_id" AND NOT COALESCE(s.__nc_deleted, false)
WHERE NOT COALESCE(c.__nc_deleted, false)`;

export const linkLabColumns = [
  'client_id', 'client_name', 'stack_id', 'stack', 'platform_account_id', 'linkedin_url', 'data_issue'
] as const;
