-- Read only. Run through the existing database operator, not from the new VPS.
-- Zero rows required before handing bridge identity to the new machine.
SELECT client_id, profile_id, locale,
       state->'grant'->>'phase' AS grant_phase,
       state->'grant'->>'error' AS grant_error,
       state->'grant'->'bridgeClear'->'claim'->>'deviceId' IS NOT NULL AS has_device_claim,
       state->'grant'->'bridgeClear'->'result'->>'state' AS bridge_result
FROM noco.octo_profiles
WHERE state->'grant'->>'clearMethod' = 'bridge'
  AND state->'grant'->>'phase' IS DISTINCT FROM 'complete'
ORDER BY client_id, profile_id;
