#!/usr/bin/env python3
"""Read an application form's questions WITHOUT opening it, and flag the gates.

  python3 form_questions.py links.txt --out forms.json
  python3 form_questions.py https://job-boards.greenhouse.io/stripe/jobs/8172508

Greenhouse exposes the whole application form through its public API
(…/jobs/<id>?questions=true): every field, whether it is required, and every
dropdown option. That means the disqualifying question — "country you reside in",
"authorised to work in …", "years of X" with no zero option — is visible from curl,
for all ~8,000 Greenhouse boards, before anyone opens a browser.

Ashby and Lever do not expose their forms. For those the output says so, and a
browser has to read the form — see references/ats-playbook.md.

Output per link: {url, ats, title, questions:[{label, type, required, options}], gates:[…]}
`gates` is a heuristic list of questions that usually decide the application. It is
a prompt to read them first, not a verdict.
"""
import argparse, concurrent.futures, json, re, sys, urllib.request

UA = {"User-Agent": "Mozilla/5.0"}

# labels that, in practice, decide an application before a human reads it
GATE_RE = re.compile(
    r"authori[sz]ed|legally|eligib|right to work|visa|sponsor|permit|"
    r"reside|residen|located|location|based in|country|time ?zone|"
    r"years of|how many years|experience with|"
    r"video|salary|compensation|notice period|relocat|clearance|citizen",
    re.I,
)


def get(url, timeout=20):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8", "ignore")
    except Exception:
        return None


def greenhouse(url):
    m = re.search(r"greenhouse\.io/(?:embed/job_app\?for=([^&]+)&token=(\d+)|([^/]+)/jobs/(\d+))", url)
    if not m:
        return None
    org, jid = m.group(1) or m.group(3), m.group(2) or m.group(4)
    body = get(f"https://boards-api.greenhouse.io/v1/boards/{org}/jobs/{jid}?questions=true")
    if not body:
        return {"url": url, "ats": "greenhouse", "error": "API unreachable or job gone"}
    j = json.loads(body)
    questions = []
    for q in j.get("questions", []):
        f = (q.get("fields") or [{}])[0]
        questions.append({
            "label": re.sub(r"\s+", " ", q.get("label", "")).strip(),
            "type": f.get("type", ""),
            "required": bool(q.get("required")),
            "options": [v.get("label", "") for v in (f.get("values") or [])],
        })
    for block in j.get("compliance") or []:
        for q in block.get("questions", []):
            f = (q.get("fields") or [{}])[0]
            questions.append({
                "label": re.sub(r"\s+", " ", q.get("label", "")).strip(),
                "type": f.get("type", ""),
                "required": bool(q.get("required")),
                "options": [v.get("label", "") for v in (f.get("values") or [])],
                "eeo": True,
            })
    return {"url": url, "ats": "greenhouse", "title": j.get("title", ""),
            "location": (j.get("location") or {}).get("name", ""), "questions": questions}


def other_ats(url):
    for ats, pat in (("ashby", r"jobs\.ashbyhq\.com/"), ("lever", r"jobs(?:\.eu)?\.lever\.co/"),
                     ("workable", r"apply\.workable\.com/"), ("bamboohr", r"\.bamboohr\.com/")):
        if re.search(pat, url):
            return {"url": url, "ats": ats, "questions": None,
                    "note": f"{ats} does not expose its form via API — read it in the browser before drafting"}
    return {"url": url, "ats": "unknown", "questions": None, "note": "unrecognised ATS — read the form in the browser"}


def flag_gates(form):
    gates = []
    for q in form.get("questions") or []:
        label, opts = q["label"], q["options"]
        hit = GATE_RE.search(label)
        # a "years / experience" dropdown is a gate only when NO option means zero
        no_zero = bool(opts) and re.search(r"years|experience", label, re.I) and not any(
            re.match(r"\s*(0|no|none|n/a|not yet|less than|<)", o, re.I) for o in opts)
        if q["required"] and (hit or no_zero):
            reason = "years question with no zero option" if no_zero else f"matches '{hit.group(0)}'"
            gates.append({"label": label, "why": reason, "options": opts[:12]})
    return gates


def resolve(url):
    form = greenhouse(url) or other_ats(url)
    form["gates"] = flag_gates(form)
    return form


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("links", help="file with one URL per line, - for stdin, or a single URL")
    ap.add_argument("--out", default="forms.json")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    if args.links.startswith("http"):
        urls = [args.links]
    else:
        src = sys.stdin if args.links == "-" else open(args.links)
        urls = list(dict.fromkeys(l.strip() for l in src if l.strip().startswith("http")))

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        forms = list(ex.map(resolve, urls))
    json.dump(forms, open(args.out, "w"), indent=1)

    readable = sum(1 for f in forms if f.get("questions"))
    print(f"{len(forms)} links -> {readable} forms readable without a browser -> {args.out}")
    for f in forms:
        if f.get("questions") is None:
            print(f"  ?  {f['ats']:10} {f['url']}")
            continue
        req = sum(1 for q in f["questions"] if q["required"])
        print(f"  {len(f['gates']):2d} gates / {req:2d} required / {len(f['questions']):2d} fields  {f.get('title','')[:40]:40} {f['url']}")
        for g in f["gates"]:
            print(f"        ! {g['label'][:80]}  [{g['why']}]")


if __name__ == "__main__":
    main()
