#!/usr/bin/env python3
"""Find ATS board tokens the vendored lists don't have, without depending on anyone's dataset.

  python3 discover_boards.py                 # harvest + probe + merge into ../data
  python3 discover_boards.py --dry-run
  python3 discover_boards.py --names names.txt

How it works: remote-job aggregators publish company NAMES freely even when they
publish nothing else useful. An ATS board token is almost always the company name
lowercased with the punctuation removed. So: harvest names, slugify, probe the three
board APIs, keep what answers 200.

Measured hit rate: 118 company names -> 25 live boards, of which 5 were missing from
the vendored lists (including Bybit). It is slow per token and worth running rarely.
"""
import argparse, concurrent.futures, json, os, re, sys, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

# feed URL -> the key holding the company name
FEEDS = {
    "https://remoteok.com/api": "company",
    "https://remotive.com/api/remote-jobs": "company_name",
    "https://himalayas.app/jobs/api?limit=100": "companyName",
    "https://www.arbeitnow.com/api/job-board-api": "company_name",
    "https://jobicy.com/api/v2/remote-jobs?count=50": "companyName",
}

PROBES = {
    "ashby":      ("https://api.ashbyhq.com/posting-api/job-board/{t}", lambda b: '"jobs"' in b),
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{t}/jobs", lambda b: '"jobs"' in b),
    "lever":      ("https://api.lever.co/v0/postings/{t}?mode=json", lambda b: b.lstrip().startswith("[")),
}


def get(url, timeout=15, cap=None):
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)
        return (resp.read(cap) if cap else resp.read()).decode("utf-8", "ignore")
    except Exception:
        return None


def harvest():
    names = set()
    for url, key in FEEDS.items():
        body = get(url, timeout=30)
        if not body:
            print(f"  ! {url} unreachable", file=sys.stderr)
            continue
        try:
            data = json.loads(body)
        except Exception:
            continue
        rows = data if isinstance(data, list) else (data.get("jobs") or data.get("data") or [])
        got = {str(r[key]) for r in rows if isinstance(r, dict) and r.get(key)}
        names |= got
        print(f"  {url.split('/')[2]}: {len(got)} companies")
    return names


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def probe(token):
    hits = []
    for ats, (tpl, looks_right) in PROBES.items():
        body = get(tpl.format(t=token), timeout=12, cap=400)
        if body and looks_right(body):
            hits.append((ats, token))
    return hits


def load(ats):
    path = os.path.join(DATA, f"{ats}_companies.json")
    try:
        return json.load(open(path))
    except Exception:
        return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--names", help="file of company names, one per line (skips the feeds)")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.names:
        names = {l.strip() for l in open(args.names) if l.strip()}
    else:
        print("harvesting company names...")
        names = harvest()
    tokens = sorted({s for s in (slugify(n) for n in names) if len(s) > 2})
    print(f"{len(names)} names -> {len(tokens)} candidate tokens")

    found = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for hits in ex.map(probe, tokens):
            found += hits
    print(f"{len(found)} live boards")

    for ats in PROBES:
        existing = load(ats)
        known = {t.lower() for t in existing}
        new = sorted({t for a, t in found if a == ats and t.lower() not in known})
        if not new:
            continue
        print(f"  {ats}: +{len(new)} new -> {', '.join(new[:10])}{' …' if len(new) > 10 else ''}")
        if not args.dry_run:
            merged = sorted(set(existing) | set(new), key=str.lower)
            json.dump(merged, open(os.path.join(DATA, f"{ats}_companies.json"), "w"), indent=0)
    if args.dry_run:
        print("(dry run, nothing written)")


if __name__ == "__main__":
    main()
