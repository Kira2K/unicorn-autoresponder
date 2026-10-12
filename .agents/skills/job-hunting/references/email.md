# Email

Mail is load-bearing in a job search in three separate ways, and two of them are invisible until
they block you. Ask for access at intake, not when you first get stuck.

**What to ask for:** "log into your mail in the browser I'm driving." That's it — you read
verification codes and, if they want, send applications. Say plainly what you will and won't do:
read messages matching the search terms below, send only messages you have shown them first.

## 1. Verification codes that gate submission

Greenhouse answers **HTTP 428 (Precondition Required)** on submit when it wants an emailed code.
There is often no visible error at all — the submit button just goes `disabled`. Confirm by
looking at the network log for a `POST` to `boards.greenhouse.io/embed/<org>/jobs/<id>` → 428.

1. Open `https://mail.google.com/mail/u/0/#search/greenhouse`
2. The mail is from `no-reply@us.greenhouse-mail.io`, subject
   "Security code for your application to \<Company\>"
3. The page has grown eight `#security-input-N` boxes. Type the whole 8-character code into
   `#security-input-0` — the boxes distribute it themselves.
4. Submit again.

Codes are **per company**: once verified, other roles at that company go through without one.
Every failed submit issues a *new* code, so always take the newest mail.

Without mail access, each of these costs a round trip to the candidate, and blocked applications
pile up — during one run, four companies sat blocked for a day waiting on codes.

## 2. Applying by email

Some of the best roles have no form at all: Hacker News "who is hiring" posts, `careers@` and
`jobs@` addresses, and small companies that just print an address. These convert well because
almost nobody applies through them.

**Never send without showing the draft first.** Write it to `emails/<company>.md`, show it, send
on their word. It goes out under their name, from their address, to a real person.

Subject line that works: `<Role> — <Candidate name> (<where you found it>)`, e.g.
`HN Software Engineer — Alexander Natashkin`. Body: the cover-letter structure from
`answering.md`, cut to about half. Attach the CV.

### Driving Gmail through a browser tool

The UI is localised, so match on the attribute *prefix* rather than the full string, and never put
a quoted non-ASCII `aria-label` inside a CSS selector — the quoting breaks. Iterate over elements
and compare in code instead.

| Target | How to reach it |
|---|---|
| Compose | `div[gh="cm"]` |
| To | an `input` whose `aria-label` starts with the localised "Recipients" — find by iterating |
| Subject | `input[name=subjectbox]` |
| Body | `div[contenteditable="true"][aria-label]` inside the compose dialog — set via `innerText` |
| Attach | `div[command="Files"]` inside `div[role="dialog"]` opens the file chooser |
| Send | `div[role="button"][data-tooltip*="Send"]` (localised — match on the prefix) |

**Verify in Sent, with a forced reload**: `https://mail.google.com/mail/u/0/?pli=1#sent`.
The message list is cached from Inbox; without the reload you will be reading a stale list and
may report a send that didn't happen.

## 3. Replies, after you stop looking

Everything applied to lands back in this mailbox: rejections, recruiter questions, scheduling
links with expiry dates. Sweep it at the start of each session — see `after-submitting.md`.

Useful searches:

```
from:greenhouse-mail.io                     # verification codes
from:(ashbyhq.com OR hire.lever.co)         # ATS acknowledgements and rejections
subject:(interview OR "next steps" OR "schedule")
newer_than:2d -from:me                      # what arrived since the last session
```

## Privacy line

You are in someone's personal mailbox. Read what the task needs — codes, replies to applications
you sent — and nothing else. Don't summarise unrelated mail, don't act on anything outside the job
search, and don't send a message they haven't seen.
