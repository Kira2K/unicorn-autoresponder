# Unicorn Proxy Checker: local API, Postman and private Render service

## API contract

Two primary business endpoints return completed results directly:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/proxies/best` | Fetch NodeMaven credentials, generate candidates for a required location and return the best verified match |
| POST | `/v1/proxies/check` | Test exactly one supplied proxy, including a returned winner's URL |

`GET /health` is infrastructure health. `/docs` and `/openapi.json` describe the
API. The old job endpoints remain callable for compatibility, but are hidden
from Swagger. The two new endpoints need no job polling.

### Get a proxy by NodeMaven key

```json
{
  "unicorn_proxy_checker_secret_key": "YOUR_SERVICE_SECRET",
  "api_key": "YOUR_NODEMAVEN_KEY",
  "count": 20,
  "location": {
    "country": "us",
    "region": "california",
    "city": "san_francisco"
  }
}
```

`api_key` and `location` are required. Within location, country is required;
region and city are required whenever their respective catalogue level contains
options. If a level has no options, omit it. No region/city is inferred automatically.
ZIP remains an alternative to region/city targeting.
Defaults are residential, mixed IPv4/IPv6, SOCKS5, quality filter, automatically
generated sticky session IDs, and 20 candidates. Maximum count is 100. Each job checks at most 10 candidates concurrently;
all requested candidates are checked before selecting the best location match.

### Separate provider settings

All settings below belong in the `location` object. Omit settings you do not need.

| Field | Values/default | Notes |
| --- | --- | --- |
| country | Two-letter code, required | `us`, `es`, `ge`; use `gb`, not `uk` |
| region | Exact catalogue code, 1–200 characters | Required when the country has regions |
| city | Exact catalogue code, 1–200 characters | Required when the selected hierarchy has cities |
| zip | Optional ZIP/postal code | Cannot coexist with region or city |
| isp | Optional provider carrier code/name | E.g. `verizon`; not NodeMaven's static ISP product |
| connection_type | `residential` (default), `mobile` | Mobile adds `type-mobile` |
| ipv4_only | false (default), true | true adds `ipv4-true` |
| session_mode | `sticky` (default), `rotating` | Rotating omits SID and requires count=1; cannot use session_id, ttl_seconds or norotate |
| session_id | Optional alphanumeric, 1–32 characters | Requires count=1; otherwise each candidate gets a distinct 13-character SID |
| ttl_seconds | Optional integer 60–86400 | Converted to provider duration syntax, e.g. 500 → `8m20s` |
| filter_mode | `quality` (default), `quality_speed`, `speed`, `max_pool` | Maps to documented filter/speed flags |
| norotate | false (default), true | true prevents fallback rotation when session IP goes offline |
| protocol | `socks5` (default), `http`, `https` | HTTP/HTTPS use the HTTP gateway; HTTPS requests use CONNECT |
| port | Optional protocol-compatible port | SOCKS5: 1080–2080 / 42000–43000; HTTP(S): 8080–9080 / 32000–33000 |

Region and city are exact catalogue codes: preserve case, Unicode, apostrophes,
slashes and all other non-control characters. Do not slugify or trim them.
Country remains a two-letter ISO code. The server checks the selected country,
region and city hierarchy using the authenticated NodeMaven catalogue before
creating candidates. Unknown codes and missing available hierarchy levels return
HTTP 422 with `provider_location_invalid`. Unavailable catalogues fail closed.
ZIP/ISP keep their existing input normalization rules.

Regression example: `country=es`, `region=basque_country`,
`city=donostia_/_san_sebastian`. The exact city code is sent to the gateway;
URL percent-encoding preserves its value rather than changing the code.
The actual exit city must exactly match a confirmed display name, explicit alias,
or slash-separated name alternative in the catalogue (case/whitespace and Unicode
NFC are normalized only for comparison). There is no fuzzy matching or arbitrary
accent/transliteration conversion. Invalid codes never fall back to another place.
Authentication-length limitations return `provider_geography_unsupported`.
If all exact-target candidates fail, `best_proxy=null` and the error is
`provider_geography_unavailable`; this does not claim the gateway's precise failure
cause is known. No alternative geography is attempted.

Sources: [NodeMaven parameters](https://docs.nodemaven.com/en/articles/12663937-understanding-your-proxy-string),
[locations](https://docs.nodemaven.com/en/articles/9596833-available-locations).

### Test your own proxy

```json
{
  "unicorn_proxy_checker_secret_key": "YOUR_SERVICE_SECRET",
  "proxy": "socks5h://LOGIN:PASSWORD@HOST:1080"
}
```

Accepted: one `host:port:login:password` string (SOCKS5), `host:port`, or one
`socks5://`, `socks5h://`, `http://`, `https://` URL. Credentials in a URL must
be URL-encoded. Multiple input lines are rejected, including duplicate lines.
Private/LAN/loopback proxy addresses are rejected; public DNS results are pinned
before connecting. The own-proxy operation does not require a NodeMaven key.

### Results and errors

`/v1/proxies/best` returns `BestProxyResponse`: one `best_proxy`, timestamps,
status, check_id and error; there is no `results` array. All candidates are still
checked and ranked internally. `/v1/proxies/check` retains `CheckResponse` with
its single-proxy `results` array.
CAPTCHA detection is always enabled. It can produce detected/not_detected/unknown.
Detected CAPTCHA reduces Trust; it does not automatically exclude the proxy.
The score is 60% Trust + 40% Latency, and Latency is relative to this request's
candidate pool. A one-proxy Latency score is not a useful cross-run benchmark.

For provider requests, the selected proxy must have a confirmed country match,
and a city match when city is requested. Unknown/mismatching geo candidates remain
retained internally with `location_matches=false`, but cannot win. Region, ZIP and ISP are
sent to NodeMaven; the checker does not independently confirm those attributes.
Geolocation is based on an external database, so a reported mismatch can also
reflect geo database differences or rotation. No silent widening of location occurs.
No match returns HTTP 200 with `best_proxy=null` and `error.code=no_location_match`.
No working candidates returns `no_working_proxy`.

401: wrong service secret. 422: invalid arguments/proxy/provider credentials.
429: both concurrent check slots are busy (Retry-After: 30). 502: provider request
failed or was unauthorized/rate-limited. Raw network exceptions and input secrets
are not included in errors. Successful proxy URLs contain proxy credentials.

## Local startup

```powershell
cd C:\Users\kiras\proxy_checker_client
# Dependencies are installed locally already; on a new machine:
# python -m venv .venv
# .\.venv\Scripts\python.exe -m pip install -r requirements.txt
# Create .env from .env.example only if .env does not already exist.
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8002 --env-file .env
```

Required server environment: `UNICORN_PROXY_CHECKER_SECRET_KEY` (one random shared secret).
Optional reputation variables: ABUSEIPDB_KEY, PROXYCHECK_KEY,
SCAMALYTICS_USERNAME, SCAMALYTICS_KEY, SCAMALYTICS_NODE (EU/US).
Missing reputation keys skip their checks; no full reputation assurance is implied.
CHECK_DURATION_SECONDS defaults to 20. This is the probe series duration, NOT an
overall request timeout: extra probes, reputation and up to ten concurrent
candidates per request increase elapsed time. Two requests can run simultaneously.

## Postman

1. Import `postman_collection.json` (no real secrets are included).
2. Set local collection/environment variables:
   - base_url = `http://127.0.0.1:8002`
   - unicorn_proxy_checker_secret_key = exact server UNICORN_PROXY_CHECKER_SECRET_KEY value
   - nodemaven_api_key = your active NodeMaven API key
3. Set Postman's request timeout to 900000 ms for the 10-candidate tests.
4. Send Best proxy — Barcelona, Tbilisi, or San Francisco. Each uses count=20.
5. The collection saves the winning URL in local variable `proxy_url`.
6. Send Check selected proxy to retest that winner through the second endpoint.

Use Postman Desktop or a local Desktop Agent to access localhost. Postman's
cloud runner cannot reach your machine's loopback address. Keep secrets and
returned proxy URLs local; do not share populated collections/environments.
Use an active NodeMaven plan with available traffic. Tests consume provider traffic.

## Reproducible live verification

Add NODEMAVEN_API_KEY to local .env (only the test script needs it; production
receives provider keys per request). With the server running:

```powershell
.\.venv\Scripts\python.exe scripts\live_city_tests.py --base-url http://127.0.0.1:8002
```

The script runs Barcelona (es), Tbilisi (ge), San Francisco (us), count=10 each,
then tests one successfully selected proxy through `/v1/proxies/check`. It prints
summaries to the console without service/provider keys or proxy passwords; no report file is created.
`TEST_RESULTS.md` contains the observed status of this implementation's testing.
Live failure due to unavailable inventory is not an automated test success.

## Separate private GitHub repository

Same GitHub account is fine. The repository can be separate and private. Render
must be granted access to that repository through its GitHub integration.
Use the prepared deployment bundle, not your entire local project folder: the
bundle excludes `.env`, installed Python, virtualenv, logs and unrelated documents.

Unzip `proxy-checker-render.zip` into a NEW folder and create a repository there:

```powershell
git init
git add .
git commit -m "Add private proxy checker API"
gh repo create unicorn-proxy-checker --private --source . --remote origin --push
```

These are instructions; no remote repository was created or pushed automatically.
GitHub authentication/permissions and an available repository name are required.

## Render Private Service

1. Connect the new private repo to Render.
2. Create a Private Service (not a public Web Service), or use its render.yaml.
3. Choose the SAME Render workspace and region as the consuming services.
   The same GitHub account alone does not establish private connectivity.
4. Build: `pip install -r requirements.txt`.
5. Start: `uvicorn api:app --host 0.0.0.0 --port $PORT --workers 1`.
6. Set PORT=10000 if it is not provided by Render; set UNICORN_PROXY_CHECKER_SECRET_KEY and
   optional reputation keys in Environment. Do not commit secret values.
7. Give consuming services the shared secret and the internal base URL from
   Render's Connect → Internal / Service Address, e.g. `http://HOST:10000`.
8. Place it in the same project/environment as the other services if desired;
   ensure environment network policies allow communication.

Private services have no public onrender.com URL. Local Postman cannot directly
reach the deployed private hostname. Test from Render Shell or a service on the
same private network, or through an authenticated endpoint on an existing public
backend that calls it internally. Local Postman continues to work with localhost.
Docker is not required.

[Render Private Services](https://render.com/docs/private-services),
[private network scope](https://render.com/docs/private-network),
[Blueprint reference](https://render.com/docs/blueprint-spec).

Current implementation is one process/one instance; the synchronous endpoints
hold requests open. Calls can exceed upstream timeouts. For large pools and
reliable retries, use the retained job API or add a persistent queue and database.
Legacy job results are in memory and disappear on restart. Live network checks
are not deterministic and a selected session can expire or change later.
