#!/usr/bin/env python3
"""Sweep every Ashby / Greenhouse / Lever board and dump one row per posting.

  python3 sweep_boards.py --out rows.json          # all three, ~16k boards, ~20 min
  python3 sweep_boards.py --ats ashby --workers 8
  python3 sweep_boards.py --refresh                # pull newer tokens, then sweep

Board tokens ship with the skill in ../data/<ats>_companies.json, so a sweep needs
nothing but this file and a network connection to the ATS APIs themselves.
--refresh MERGES upstream into the local list and never shrinks it: if the upstream
dataset moves or dies, you lose new companies, not your list.
Run discover_boards.py to find boards no dataset has.

Output: JSON array of [ats, org, title, location, url].
Descriptions are NOT fetched (that would be 130k extra requests) — filter on title
and location first, then pull bodies for the survivors with fetch_postings.py.

Keep --workers at 8-12. Higher saturates the connection and starts breaking the
browser session you are applying through, which looks exactly like a broken form.
"""
import argparse, concurrent.futures, json, os, sys, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
UPSTREAM = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/HEAD/data/{ats}_companies.json"


def get(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers=UA)
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")
    except Exception:
        return None


def parse_ashby(org, body):
    for j in json.loads(body).get("jobs", []):
        secondary = " | ".join(
            (l.get("location", "") if isinstance(l, dict) else str(l))
            for l in (j.get("secondaryLocations") or [])
        )
        yield ("ashby", org, j.get("title", ""),
               f"{j.get('location', '')} {secondary}".strip(), j.get("jobUrl", ""))


def parse_greenhouse(org, body):
    for j in json.loads(body).get("jobs", []):
        # absolute_url is often the company's own careers page (…?gh_jid=123), which no
        # API resolves. Keep it when it already points at a board (that preserves the EU
        # host); otherwise rebuild the canonical board URL from the id, which always works.
        url = j.get("absolute_url") or ""
        if "greenhouse.io/" not in url:
            url = f"https://job-boards.greenhouse.io/{org}/jobs/{j.get('id')}"
        yield ("greenhouse", org, j.get("title", ""),
               (j.get("location") or {}).get("name", ""), url)


def parse_lever(org, body):
    arr = json.loads(body)
    if not isinstance(arr, list):
        return
    for j in arr:
        cat = j.get("categories") or {}
        yield ("lever", org, j.get("text", ""),
               f"{cat.get('location', '')} {j.get('workplaceType', '')}".strip(),
               j.get("hostedUrl", ""))


ATS = {
    "ashby":      ("https://api.ashbyhq.com/posting-api/job-board/{org}", parse_ashby),
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{org}/jobs", parse_greenhouse),
    "lever":      ("https://api.lever.co/v0/postings/{org}?mode=json", parse_lever),
}


def token_path(ats):
    return os.path.join(DATA, f"{ats}_companies.json")


def load_tokens(ats):
    try:
        return json.load(open(token_path(ats)))
    except Exception:
        return []


def refresh(ats):
    """Merge upstream into the local list. Never shrinks it."""
    local = load_tokens(ats)
    body = get(UPSTREAM.format(ats=ats), timeout=40)
    if not body:
        print(f"  ! {ats}: upstream unreachable, keeping {len(local)} local tokens", file=sys.stderr)
        return local
    try:
        upstream = json.loads(body)
    except Exception:
        print(f"  ! {ats}: upstream is not JSON, keeping {len(local)} local tokens", file=sys.stderr)
        return local
    merged = sorted(set(local) | {str(t).strip() for t in upstream if str(t).strip()}, key=str.lower)
    json.dump(merged, open(token_path(ats), "w"), indent=0)
    print(f"  {ats}: {len(local)} -> {len(merged)} tokens (+{len(merged) - len(local)})")
    return merged


def fetch(task):
    ats, org = task
    url_tpl, parse = ATS[ats]
    body = get(url_tpl.format(org=org))
    if not body:
        return [], "request failed"
    try:
        data = json.loads(body)
        jobs = data if ats == "lever" else data.get("jobs")
        if not isinstance(jobs, list):
            return [], "invalid response schema"
        return list(parse(org, body)), None
    except Exception:
        return [], "invalid response"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ats", nargs="*", default=list(ATS), choices=list(ATS))
    ap.add_argument("--out", default="rows.json")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--refresh", action="store_true", help="merge newer tokens from upstream first")
    args = ap.parse_args()
    if not args.ats:
        ap.error("select at least one ATS")

    tasks = []
    for ats in args.ats:
        tokens = refresh(ats) if args.refresh else load_tokens(ats)
        if not tokens:
            # A silently empty sweep is the worst failure mode: it looks like "no jobs today".
            sys.exit(f"FATAL: no tokens for {ats}. Expected {token_path(ats)}. "
                     f"Re-run with --refresh, or run discover_boards.py.")
        tasks += [(ats, t) for t in tokens]
    print(f"{len(tasks)} boards", flush=True)

    rows, done = [], 0
    counts = {ats: {"ok": 0, "failed": 0} for ats in args.ats}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for (ats, _), (got, error) in zip(tasks, ex.map(fetch, tasks)):
            counts[ats]["failed" if error else "ok"] += 1
            rows += got
            done += 1
            if done % 1000 == 0:
                print(f"  {done}/{len(tasks)} boards, {len(rows)} postings", flush=True)

    for ats, count in counts.items():
        print(f"{ats}: {count['ok']} successful, {count['failed']} failed boards", file=sys.stderr)
    unavailable = [ats for ats, count in counts.items() if not count["ok"]]
    if unavailable:
        sys.exit(f"FATAL: no successful board responses for {', '.join(unavailable)}; output left unchanged")
    if any(count["failed"] for count in counts.values()):
        print("! Partial sweep: failed boards may hide postings; retry before declaring the search exhausted.", file=sys.stderr)
    with open(args.out, "w") as fh:
        json.dump(rows, fh)
    print(f"{len(rows)} postings -> {args.out}")


if __name__ == "__main__":
    main()
