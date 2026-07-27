# HH Responses Calendar Mode TODO

Status: planned.

## Goal
Build HH responses calendar mode so the basic HH response scenario can be
scheduled, prevalidated, reported, and operated by a non-technical user.

## TODO
- Auto-launch HH responses every Monday through Thursday at 5:00 AM GMT+3.
- Prevalidate broken HH accounts at 5:00 PM GMT+3 and before run start.
- Use Telegram only to report mistakes/problems during prevalidation, matching
  current reporting behavior.
- Before each run, include accounts that became fixed after prevalidation.
- After finish, revalidate broken accounts and automatically run only the
  accounts that became fixed.
- Add more logs to detect natural HH UI changes.
- Implement "HH account top up" with load balancing.
- Analyze the current workflow and reduce per-account run time without adding
  new errors.
- Add `Алабуга` to the existing company-name ban list alongside existing
  `Komtek`.
- Add HH vacancy/position ID-based banning; company-name banning is already
  ready.
- Respond with the best-fitting CV only, while still saving positions as
  successfully applied.
- Identify Moscow-located vacancies in the En market (script + AI) and
  respond with the current CV, including English CVs.
- Add a reporting feature that uses the Unicorn support bot instead of Kira's
  Telegram account.
- Verify the system is ready for AI-tailored cover letters and external
  captcha-solving services.
- Add better logs and handling for `no_terminal_stop_reason` outcomes.
- Simplify usage for a non-tech collegues
- Unite with tg bot to ping students with NocoDB-measured poor filling rate

## Test Checklist
- Verify the onboarding link resolves from `docs/ONBOARDING.md`.
- Search the onboarding TODO list and confirm the calendar-mode entry no longer
  uses a `no link` target.
- Use `Kira` account for test purposes
