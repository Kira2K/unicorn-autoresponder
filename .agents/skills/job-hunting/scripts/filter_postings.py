#!/usr/bin/env python3
"""Cut a sweep down to a shortlist, using the criteria block in profile.md.

  python3 filter_postings.py rows.json --profile profile.md
  python3 filter_postings.py rows.json --profile profile.md --bodies postings.json \
                             --applied applied-list.md --out shortlist.json

Two passes, because bodies are expensive:

  1. Title + location, on the raw sweep. Cheap, removes ~99% of a 130k-row corpus.
  2. Stack + hidden gates, once you have bodies. Run fetch_postings.py on the pass-1
     URLs, then re-run this with --bodies.

Every rejection is recorded WITH ITS REASON (--rejects). A rejection log you can't
audit is how a good role gets dropped for the wrong reason and never noticed.

A row that survives is a row worth opening. It is not a row worth applying to —
the disqualifying question is usually in the form, not the posting.
"""
import argparse, json, re, sys, urllib.parse
from collections import Counter

CRITERIA_KEYS = ("titles_in", "titles_out", "stack_in", "stack_out",
                 "geo_in", "geo_out", "exclude_employers", "hard_limits")


def load_criteria(path):
    """Parse the ```criteria block: one `key: a, b, c` per line. Not YAML, deliberately."""
    text = open(path).read()
    block = re.search(r"```criteria\s*\n(.*?)```", text, re.S)
    if not block:
        sys.exit(f"FATAL: no ```criteria block in {path}. Copy templates/profile.md.")
    out = {}
    for line in block.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        values = [v.strip() for v in value.split(",") if v.strip()]
        out[key.strip()] = values
    return out


def bounded(term):
    """Match the term as a whole word, without breaking on terms like .net, c#, next.js.

    A plain substring match is a silent-rejection bug: `unity` in stack_out matched
    "community" and "opportunity" and threw away perfectly good postings with a reason
    that read as if it were correct. Guard each edge only where the term's own character
    is alphanumeric, so `.net` still matches "ASP.NET" and `c#` still matches at all.
    """
    pattern = re.escape(term)
    if term[:1].isalnum():
        pattern = r"(?<![a-z0-9])" + pattern
    if term[-1:].isalnum():
        pattern = pattern + r"(?![a-z0-9])"
    return pattern


def compile_any(terms):
    """One regex matching any term. None when the list is empty — 'no opinion', not 'reject all'."""
    if not terms:
        return None
    return re.compile("|".join(bounded(t) for t in terms), re.I)


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def load_applied(path):
    """title -> [company, ...] already applied to.

    Matching on the URL is wrong: the same role is reachable at several URLs and boards
    rewrite them. Match on company + title instead — and compare companies by containment,
    because the log holds a human name ("Holepunch (Tether)") while the sweep holds an ATS
    token ("holepunch"), and an equality test would silently re-apply to everything.
    """
    applied = {}
    status_col = None
    for line in open(path):
        cells = [c.strip() for c in line.split("|")]
        headings = [norm(c) for c in cells]
        if "company" in headings and "status" in headings:
            status_col = headings.index("status")
            continue
        if len(cells) < 5 or not cells[1] or set(cells[1]) <= set("-# "):
            continue
        status = norm(cells[status_col]) if status_col is not None and status_col < len(cells) else ""
        # Missing/legacy statuses remain excluded until the agent reconciles the log.
        if re.match(r"^(blocked|not applied)\b", status):
            continue
        company, title = norm(cells[2]), norm(cells[3])
        if not company or not title:
            continue
        applied.setdefault(title, []).append(company)
    return applied


def was_applied(applied, org, title):
    for company in applied.get(norm(title), ()):
        if company == org or company in org or org in company:
            return True
    return False


def org_of(row):
    ats, org, title, location, url = row
    if org:
        return org
    host = urllib.parse.urlparse(url).netloc
    return host.split(".")[0] if host else url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", help="sweep output from sweep_boards.py")
    ap.add_argument("--profile", required=True)
    ap.add_argument("--bodies", help="fetch_postings.py output, enables the stack and gate checks")
    ap.add_argument("--applied", help="applied-list.md, to drop what's already been sent")
    ap.add_argument("--out", default="shortlist.json")
    ap.add_argument("--rejects", default="rejects.json")
    args = ap.parse_args()

    crit = load_criteria(args.profile)
    unknown = set(crit) - set(CRITERIA_KEYS) - {"timezone", "workplace", "relocation_ok", "salary_min_usd"}
    if unknown:
        print(f"! ignoring unknown criteria keys: {', '.join(sorted(unknown))}", file=sys.stderr)

    re_title_in   = compile_any(crit.get("titles_in"))
    re_title_out  = compile_any(crit.get("titles_out"))
    re_stack_in   = compile_any(crit.get("stack_in"))
    re_stack_out  = compile_any(crit.get("stack_out"))
    re_geo_in     = compile_any(crit.get("geo_in"))
    re_geo_out    = compile_any(crit.get("geo_out"))
    re_limits     = compile_any(crit.get("hard_limits"))
    excluded      = {norm(e) for e in crit.get("exclude_employers", [])}

    rows = json.load(open(args.rows))
    bodies = {}
    if args.bodies:
        for entry in json.load(open(args.bodies)):
            url, _, _, text = entry[:4]
            status = entry[4] if len(entry) > 4 else "unverified"
            bodies[url] = (text, status)
    applied = load_applied(args.applied) if args.applied else {}

    kept, rejected, seen = [], [], set()
    for row in rows:
        ats, org, title, location, url = row
        org_n = norm(org_of(row))

        def drop(reason):
            rejected.append({"url": url, "title": title, "org": org, "reason": reason})

        if not title:
            drop("no title in the listing")
            continue
        if org_n in excluded:
            drop("employer excluded by profile")
            continue
        if applied and was_applied(applied, org_n, title):
            drop("already applied")
            continue
        if re_title_out and re_title_out.search(title):
            drop(f"title excluded: {re_title_out.search(title).group(0)}")
            continue
        if re_title_in and not re_title_in.search(title):
            drop("title is not a role type in titles_in")
            continue
        if re_stack_out and re_stack_out.search(title):
            drop(f"unwanted stack in title: {re_stack_out.search(title).group(0)}")
            continue
        if re_geo_out and re_geo_out.search(location):
            drop(f"location excluded: {re_geo_out.search(location).group(0)}")
            continue
        body = bodies.get(url)
        note = None
        checked = "title+location"
        if body is None:
            # No body yet. Location is all we have, and it is weak evidence — an empty
            # location field means "unknown", so keep it rather than guess.
            if re_geo_in and location.strip() and not re_geo_in.search(location):
                drop(f"location '{location}' matches no geo_in term")
                continue
            if args.bodies:
                note = "body missing — fetch or open by hand"
        elif body[1] != "verified" or not body[0].strip():
            note = "body failed or unverified — fetch or open by hand"
        else:
            text, _ = body
            blob = f"{title} {location} {text}"
            if re_geo_out and re_geo_out.search(text):
                drop(f"body excludes: {re_geo_out.search(text).group(0)}")
                continue
            if re_geo_in and not re_geo_in.search(f"{location} {text[:3000]}"):
                drop("no geo_in term in location or the first 3000 chars of the body")
                continue
            if re_limits and re_limits.search(text):
                drop(f"hard limit: {re_limits.search(text).group(0)}")
                continue
            if re_stack_in and not re_stack_in.search(blob):
                drop("body never names a stack_in technology")
                continue
            if re_stack_out and (match := re_stack_out.search(text)):
                note = f"check whether unwanted stack is required: {match.group(0)}"
            checked = "title+location+body"

        # Until bodies are checked, different URLs can still have different requirements.
        # Only a retained, fully checked row may reserve a company/title key.
        key = ("role", org_n, norm(title)) if checked == "title+location+body" and not note else ("url", url)
        if key in seen:
            drop("duplicate of an earlier row")
            continue
        seen.add(key)
        result = {"ats": ats, "org": org, "title": title, "location": location,
                  "url": url, "checked": "manual-review" if note else checked}
        if note:
            result["note"] = note
        kept.append(result)

    json.dump(kept, open(args.out, "w"), indent=1)
    json.dump(rejected, open(args.rejects, "w"), indent=1)

    print(f"{len(rows)} rows -> {len(kept)} kept -> {args.out}")
    print(f"rejections by reason ({len(rejected)} total) -> {args.rejects}")
    for reason, n in Counter(r["reason"].split(":")[0] for r in rejected).most_common(12):
        print(f"  {n:7}  {reason}")
    if kept:
        print("\nshortlist:")
        for k in kept[:40]:
            print(f"  {k['title'][:52]:52} | {(k['org'] or '')[:18]:18} | {k['location'][:26]:26} | {k['url']}")
        if len(kept) > 40:
            print(f"  … and {len(kept) - 40} more in {args.out}")


if __name__ == "__main__":
    main()
