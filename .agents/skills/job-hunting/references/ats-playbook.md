# ATS playbook

Per-platform form mechanics. Every entry here cost a failed submission to learn.

## Universal rules

**Three things to set up before the first form**, each of which has cost a wasted hour:

- **The file chooser is sandboxed to the workspace.** Uploading the résumé from `~/Documents` or
  `~/Downloads` fails with "outside allowed roots". Copy it into the working directory once, at the
  start of the run, and attach it from there.
- **Mail logged in, in the same browser.** Greenhouse gates submission behind an 8-character emailed
  code, and each failed submit invalidates the previous one — see `email.md`. Not logged in, every
  code is a round-trip and the application sits half-done until the candidate answers.
- **Keep the tab open while you wait for anything.** A Greenhouse form holds its state, including
  the uploaded résumé and every essay; navigating away means filling it all in again.

**Check the form for gates before filling it.** Dump every field label first:

```js
Array.from(document.querySelectorAll('input,textarea,select')).map(e => {
  const l = (document.querySelector(`label[for="${e.id}"]`)||{}).innerText || '';
  return `${e.type||e.tagName}|${e.id||e.name}|${l.replace(/\n/g,' ').slice(0,50)}`;
}).join('\n')
```

**When a submit does nothing and no error is visible**, the answer is one of four things, in order of likelihood:

```js
// 1. what does the browser think is invalid?
[...document.querySelectorAll(':invalid')].map(e => e.name || e.id)
// 2. is the button mid-flight?
document.querySelector('button[type=submit]')?.disabled
// 3. what did the POST actually return?  (428 = e-mail code required)
//    use the network-request tool, filter on the ATS host
// 4. is there a captcha that never loaded?
document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="cloudflare"]').length
```

## Ashby

`https://jobs.ashbyhq.com/<org>/<job-uuid>/application`

- **Setting `.value` from JavaScript does not register.** React keeps its own state; the DOM shows your text and the form reports "Missing entry for required field". You must type: Playwright `fill()` or `pressSequentially()`. This is the single most expensive mistake on Ashby.
- Location is a combobox — type, wait ~1.5 s, then `Enter` to take the first suggestion.
- Resume upload: `button.ashby-application-form-input-file-dropzone-upload` opens the file chooser.
- Success text: `Success` / `Your application was successfully submitted`.
- **Anti-spam**: after several submissions from one IP, a board may answer "flagged as possible spam". It is per-board, not global — other Ashby boards keep working the same hour. Retrying rarely helps; hand that one to the candidate.

Public API for listings:
`https://api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true`
→ `jobs[]` with `title`, `location`, `secondaryLocations[]`, `descriptionHtml`, `jobUrl`, `compensation.compensationTierSummary`.

## Greenhouse

Direct form URL, bypassing the iframe:
`https://job-boards.greenhouse.io/embed/job_app?for=<org>&token=<jobId>`
EU boards exist at `job-boards.eu.greenhouse.io` but the **API host is the same** — `boards-api.greenhouse.io` serves both. There is no separate EU API.

- JavaScript `.value` injection **works** on the plain text inputs — but not on the phone/country pair or any react-select (see the two sections below).
- `#country` is the phone country picker, not residence.
- `#candidate-location` is a geocoded autocomplete: type, wait, `Enter`.
- Resume: the visible button is a sibling of the hidden `#resume` input — `div:has(> #resume) button`.
- react-select dropdowns: click the input, then read `#react-select-<fieldId>-listbox` for options.

**HTTP 428 on submit = e-mail verification code.** The page grows eight `#security-input-N` boxes. Paste the whole 8-character code into `#security-input-0` — it distributes itself. Get the code from the candidate's mail: search `from:greenhouse-mail.io`, subject "Security code for your application to \<Company\>". Codes are **per company**: once verified, other roles at that company submit freely. Each failed submit issues a *new* code, so always use the newest mail.

API: `https://boards-api.greenhouse.io/v1/boards/<org>/jobs` and `.../jobs/<id>` for the body.

## Greenhouse: the phone widget is not a text input

`#phone` and its country picker `#country` are a React/`intl-tel-input` pair. Injecting `.value` into
`#phone` leaves the number visible in the DOM and invisible to the form: submit comes back with
**"Phone is required"** and **"Select a country"** on a field that plainly shows a number. Type both:
`#country` character by character, take the option out of `react-select-country-listbox` (the
`iti-0__country-listbox` next to it is dead markup), then `#phone` **without the dialling code**.

The rest of Greenhouse's plain text inputs do accept `.value` injection — this widget is the exception,
so a form can fail on two fields while the other eight went in fine.

## Greenhouse: never pick a react-select option with arrow keys

`ArrowDown` ×N + `Enter` does **not** land on the Nth option — the first `ArrowDown` opens the menu and
highlights option 1, so the count is off by one and there is no error when it lands somewhere wrong. On a
"How many years of professional experience" field that silently submits a **false answer about the
candidate**. Type the option's text instead, confirm the listbox has narrowed to it, then `Enter`.

Verify every dropdown before submitting — they all render into the same class:

```js
[...document.querySelectorAll('.select__single-value')].map(e => e.innerText)
```

Read that list as a sentence about the candidate. If any entry is wrong, fix it before you submit; after
submission there is no edit.

## Lever

`https://jobs.lever.co/<org>/<job-uuid>/apply` (EU: `jobs.eu.lever.co`)

- Plain HTML — JavaScript `.value` injection works.
- **The email field carries a `pattern` attribute whose regex is invalid in current browsers.** `checkValidity()` throws a SyntaxError, the submit silently does nothing, and **no error appears on the page**. Fix before submitting:
  `document.querySelectorAll('input[pattern]').forEach(e => e.removeAttribute('pattern'))`
- `consent[store]` — a required consent checkbox, separate from everything else.
- `opportunityLocationId` — a hidden required `<select>` on some postings, listing the regions the company hires in.
- **Fill location LAST.** A rejected submit clears the location, résumé and link fields.
- Location must be *chosen from the dropdown*, not typed: click the suggestion, then verify `[name=selectedLocation]` holds JSON.
- Success: URL ends in `/thanks`.

API: `https://api.lever.co/v0/postings/<org>?mode=json` (EU: `api.eu.lever.co`).

## Workable

- Listings: `https://apply.workable.com/api/v1/widget/accounts/<token>?details=true`
- On `jobs.workable.com` a cookie backdrop blocks the Apply button — accept cookies first.
- The résumé `<input type=file>` is hidden behind `div[data-role="dropzone"]`; click the dropzone, not the input.
- Submission runs through **Cloudflare Turnstile**. If the challenge endpoints return 400 the form hangs on "Submitting…" forever with no error. Nothing you can do in-page; hand it over.

## BambooHR

`https://<org>.bamboohr.com/careers/<id>` — listings at `/careers/list`, detail at `/careers/<id>/detail`.

- **Changing Country resets the Province field and changes its element id.** Fill country first, then the address fields.
- Résumé: a real button labelled "Choose File" sits next to the hidden input.
- reCAPTCHA here is the **v2 checkbox**. It must be clicked or submit does nothing and shows no error:
  `iframe[title="reCAPTCHA"]` → `#recaptcha-anchor`, click through the frame. Then verify `[name="g-recaptcha-response"]` has a value before submitting.

## Workday

`POST https://<tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs`
body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":"..."}` — public, no auth.

**Discovery only.** Applying requires creating an account per company, which you should not do on someone's behalf. Also: the location label on a Workday posting frequently contradicts the body text — a job tagged "Worldwide" can say "must be located within the U.S." three paragraphs in. Read the body.

## Network failures that look like application failures

- **reCAPTCHA never initialises** (`typeof window.grecaptcha === 'undefined'`, zero recaptcha iframes) → the network can't reach `www.google.com` / `www.gstatic.com`. Some boards load it from `www.recaptcha.net` and work fine on the same machine, so the symptom is intermittent across employers. Loading the mirror script yourself is blocked by CSP. Ask the candidate to disable the VPN or DNS filter.
- **Cloudflare challenge returns 400** → same class of problem, different vendor.
- Confirm before blaming the form:
  `curl -s -o /dev/null -w '%{http_code}' --max-time 6 https://www.google.com`
