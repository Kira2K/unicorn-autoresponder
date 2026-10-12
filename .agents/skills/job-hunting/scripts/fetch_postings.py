#!/usr/bin/env python3
"""Resolve job links to (url, title, location, body_text, extraction_status).

  python3 fetch_postings.py links.txt --out postings.json
  pbpaste | python3 fetch_postings.py - --out postings.json

Recognises Ashby / Greenhouse / Lever / Workable / Recruitee / SmartRecruiters
links and pulls the posting from the ATS API, which gives clean text. Anything
else falls back to stripping the HTML, marked unverified for manual review.
Only a nonempty ATS description is verified. Legacy four-column rows have no
provenance and must be re-fetched or reviewed before filtering on their bodies.

A row with an empty body is a FETCH FAILURE, not a job without a description.
Never reject on an empty body — re-check those by hand. In one run of 244 links,
31 came back empty and every one of them was a fetch problem (aggregator paywalls,
mostly), not a bad posting.
"""
import argparse, concurrent.futures, html, json, re, ssl, sys, urllib.parse, urllib.request

CTX = ssl.create_default_context()
UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "text/html,application/json",
}


def get(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers=UA)
        return urllib.request.urlopen(req, timeout=timeout, context=CTX).read().decode("utf-8", "ignore")
    except Exception:
        return None


def clean(markup):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup or ""))).strip()


def from_ashby(url):
    m = re.search(r"jobs\.ashbyhq\.com/([^/]+)/([0-9a-f-]{36})", url)
    if not m:
        return None
    org, jid = urllib.parse.unquote(m.group(1)), m.group(2)
    body = get(f"https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true")
    if not body:
        return None
    for j in json.loads(body).get("jobs", []):
        if jid in j.get("jobUrl", ""):
            secondary = [(l.get("location") if isinstance(l, dict) else str(l))
                         for l in (j.get("secondaryLocations") or [])]
            pay = (j.get("compensation") or {}).get("compensationTierSummary") or ""
            return (j.get("title", ""),
                    f"{j.get('location', '')} {' | '.join(secondary)}".strip(),
                    f"{pay} {clean(j.get('descriptionHtml', ''))}".strip())
    return None


def from_greenhouse(url):
    m = re.search(r"greenhouse\.io/(?:embed/job_app\?for=([^&]+)&token=(\d+)|([^/]+)/jobs/(\d+))", url)
    if not m:
        return None
    org = m.group(1) or m.group(3)
    jid = m.group(2) or m.group(4)
    # one API host serves both the US and EU boards
    body = get(f"https://boards-api.greenhouse.io/v1/boards/{org}/jobs/{jid}")
    if not body:
        return None
    j = json.loads(body)
    return (j.get("title", ""), (j.get("location") or {}).get("name", ""), clean(j.get("content", "")))


def from_lever(url):
    m = re.search(r"jobs(?:\.eu)?\.lever\.co/([^/]+)/([0-9a-f-]{36})", url)
    if not m:
        return None
    org, jid = m.group(1), m.group(2)
    for host in ("api.lever.co", "api.eu.lever.co"):
        body = get(f"https://{host}/v0/postings/{org}?mode=json")
        if not body:
            continue
        try:
            arr = json.loads(body)
        except Exception:
            continue
        for j in arr:
            if j.get("id") == jid:
                cat = j.get("categories") or {}
                text = clean(j.get("description", "")) + " " + " ".join(
                    clean(l.get("content", "")) for l in (j.get("lists") or []))
                return (j.get("text", ""),
                        f"{cat.get('location', '')} {j.get('workplaceType', '')}".strip(),
                        text.strip())
    return None


def from_workable(url):
    m = re.search(r"apply\.workable\.com/([^/]+)/j/([0-9A-F]+)", url, re.I)
    if not m:
        return None
    org, jid = m.group(1), m.group(2)
    body = get(f"https://apply.workable.com/api/v1/widget/accounts/{org}?details=true")
    if not body:
        return None
    for j in json.loads(body).get("jobs", []):
        if j.get("shortcode", "").upper() == jid.upper():
            return (j.get("title", ""),
                    f"{j.get('city', '')} {j.get('country', '')} {j.get('workplace', '')}".strip(),
                    clean(j.get("description", "")) + " " + clean(j.get("requirements", "")))
    return None


def from_recruitee(url):
    m = re.search(r"([\w-]+)\.recruitee\.com/o/([\w-]+)", url)
    if not m:
        return None
    body = get(f"https://{m.group(1)}.recruitee.com/api/offers/")
    if not body:
        return None
    for j in json.loads(body).get("offers", []):
        if j.get("slug") == m.group(2):
            return (j.get("title", ""), j.get("location", ""), clean(j.get("description", "")))
    return None


def from_smartrecruiters(url):
    m = re.search(r"jobs\.smartrecruiters\.com/([^/]+)/(\d+)", url)
    if not m:
        return None
    body = get(f"https://api.smartrecruiters.com/v1/companies/{m.group(1)}/postings/{m.group(2)}")
    if not body:
        return None
    j = json.loads(body)
    loc = j.get("location") or {}
    sections = (j.get("jobAd") or {}).get("sections") or {}
    text = " ".join(clean((sections.get(k) or {}).get("text", "")) for k in sections)
    return (j.get("name", ""),
            f"{loc.get('city', '')} {loc.get('country', '')} {'remote' if loc.get('remote') else ''}".strip(),
            text)


RESOLVERS = (from_ashby, from_greenhouse, from_lever, from_workable, from_recruitee, from_smartrecruiters)


def fetch(url):
    for resolver in RESOLVERS:
        try:
            got = resolver(url)
        except Exception:
            got = None
        if got:
            return (url,) + got + ("verified" if got[2].strip() else "failed",)
    page = get(url)
    if not page:
        return (url, "", "", "", "failed")
    title = re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I)
    return (url, clean(title.group(1)) if title else "", "", clean(page)[:20000], "unverified")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("links", help="file with one URL per line, or - for stdin")
    ap.add_argument("--out", default="postings.json")
    ap.add_argument("--workers", type=int, default=10)
    args = ap.parse_args()

    src = sys.stdin if args.links == "-" else open(args.links)
    urls = list(dict.fromkeys(l.strip() for l in src if l.strip().startswith("http")))
    print(f"{len(urls)} links", flush=True)

    rows, done = [], 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for row in ex.map(fetch, urls):
            rows.append(row)
            done += 1
            if done % 25 == 0:
                print(f"  {done}/{len(urls)}", flush=True)

    with open(args.out, "w") as fh:
        json.dump(rows, fh)
    unverified = sum(1 for r in rows if r[4] != "verified")
    print(f"{len(rows)} postings -> {args.out}")
    if unverified:
        print(f"! {unverified} failed or unverified descriptions — open them by hand")


if __name__ == "__main__":
    main()
