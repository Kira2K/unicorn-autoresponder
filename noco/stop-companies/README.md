# Stop Companies

Builds relations between raw stop-company restrictions and the company directory.

Inputs:

- NocoDB `client_company_restrictions_from_stop_companies`
- NocoDB `companies_from_applications`

Outputs:

- Creates missing company rows with `source = stop_companies`.
- Links restriction rows to company rows with `rel_restrictions_blocked_companies`.
- Writes reports under `logs/nocodb-stop-companies/<timestamp>/`.

Safety:

- No client links are repaired here.
- Rows without a native client relation are reported in `missing-client-relation-review.json`.
- Default command behavior is dry-run.
