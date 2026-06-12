# Required Proxy Check

Read-only diagnostic feature for finding profiles that need proxy work.

## Command

```bash
npm run proxy:check-required
npm run proxy:check-required -- --market Ru
npm run proxy:check-required -- --redact-proxy-connections
```

Default market is `En`.

Proxy connection values in the split invalid proxy reports are visible by
default because this is an internal diagnostic instrument. For safer shared
reports, enable redaction with:

```bash
npm run proxy:check-required -- --redact-proxy-connections
```

or:

```powershell
$env:PROXY_PROVIDER_REDACT_PROXY_CONNECTIONS='true'; npm run proxy:check-required
```

In POSIX shells:

```bash
PROXY_PROVIDER_REDACT_PROXY_CONNECTIONS=true npm run proxy:check-required
```

## Sources

- Reads only `ПЕРС ДАННЫЕ`.
- Does not read `Dolphin main`.
- Uses Dolphin Cloud API for real profile/proxy state.

## Behavior

- Includes only clients with filled `Id общего чата`.
- Uses `Dolphin Profile En Id` / `Dolphin Profile Ru Id`.
- Uses `Прокси En` / `Прокси Ru` when the row exists.
- If the market proxy row is missing, sheet proxy values are treated as empty and the checker still verifies Dolphin state by profile id.
- Reads Dolphin profiles by id and all Dolphin proxies once per run.
- Reads Dolphin profile inventory once per run to detect profiles that exist in Dolphin but are not connected back to `ПЕРС ДАННЫЕ`.
- Treats Dolphin API as the authority for real attached proxy state.

If a sheet proxy exists but the profile has no attached proxy, the checker searches the whole Dolphin proxy inventory by exact proxy name. If it exists there, the client is considered `ok` with note `proxy_exists_not_attached`.

## Current Name Limitation

Existing Dolphin proxy names store client name parts in English/transliteration, while `ПЕРС ДАННЫЕ` currently stores the client name only in Russian. Because of that, this checker cannot safely verify proxy ownership by client name today.

For now, proxy-name validation intentionally checks only stable ids:

- legacy format: `profileId` and `chatId`
- standard format: `chatId`

TODO: add English client name fields to `ПЕРС ДАННЫЕ` later, then restore client-name validation against Dolphin proxy names.

## Reports

Each run writes to:

```text
dolphin/proxyProvider/checkRequiredProxy/reports/<timestamp>/
```

Files:

- `status.json`
- `status.md`
- `summary.txt`
- `needs-proxy.json`
- `missing-profile-id-errors.json`
- `invalid-proxy-own-name-errors.json`
- `invalid-proxy-saved-name-errors.json`
- `invalid-proxy-saved-name-map.txt`
- `data-mismatch-errors.json`
- `run.log`

The latest run directory path is also written to:

```text
dolphin/proxyProvider/checkRequiredProxy/reports/latest.txt
```

`summary.txt` contains a quick count summary for the run, including status
counts and the main error-table counts.

`invalid-proxy-own-name-errors.json` contains invalid names of real Dolphin
proxy records found through attached proxy data or Dolphin proxy inventory.

`invalid-proxy-saved-name-errors.json` contains invalid proxy values saved in
`ПЕРС ДАННЫЕ`, for example when the sheet stores a proxy connection string
instead of our proxy display name format.

`invalid-proxy-saved-name-map.txt` is a two-column text mapper for manual sheet
cleanup. Each line uses:

```text
client name >>> correct Dolphin proxy name
```

The correct proxy name is picked only from Dolphin data already found in the
run, usually the valid attached `checkedProxyName` or the first
`correctProxyNameMatches` entry. The checker does not invent names here.

## Existing Profile Lookup

When `Dolphin Profile En Id` / `Dolphin Profile Ru Id` is empty, the checker searches Dolphin profiles by exact normalized name.

Valid profile name formats:

- `firstname stack market`
- `firstname secondname stack market`

Profiles with names outside these formats are ignored by this check. Matching profiles are reported with issue `profile_exists_but_not_connected` and saved to `profile-exists-but-not-connected-errors.json`.

## Future TODO

- Add explicit apply mode that can update `ПЕРС ДАННЫЕ` from real Dolphin data when:
  - `sheet_missing_api_has_proxy`
  - `sheet_proxy_differs_from_api`
- Keep the current checker read-only until sheet sync is approved separately.
