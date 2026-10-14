Source: `C:\Users\kiras\proxy_checker_client\frontend-contract`, copied 2026-10-14.

`api-types.ts`, `openapi.json`, and `README.md` are copied from the supplied contract.
The refreshed export defaults to 20 candidates and permits up to 100. The Octo
adapter requests 20; its contract test checks this against the exported default.
`POSTMAN_RENDER.md` is also copied as the integration reference. The two public
business endpoints remain synchronous and their response shapes are unchanged.

`api-client.ts` preserves the supplied endpoint contracts and request behavior with
three local runtime adaptations: explicit `.js` extensions on type-only imports, constructor
property assignments compatible with Node's TypeScript stripping, and an optional
fifth `fetchImpl` argument for dependency injection. `package.json` marks this copied
client as an ES module without changing the repository's package mode.

The server-only Octo wrapper validates untrusted response values and maps failures
to constant Octo errors. Successful responses and their credential-bearing proxy
URLs stay internal to the workflow. `location_matches` is checked together with
presence of country and, when requested, city. The upstream service verifies actual
country codes and city matches; its `country` output is a display name. Region is
provider targeting and is not independently verified by the checker.

The 2026-10-14 geography refresh accepts exact catalogue codes up to 200 characters,
including slash, apostrophes and Unicode. A live request using
`es / basque_country / donostia_/_san_sebastian` passed with a matching city and score 78.
