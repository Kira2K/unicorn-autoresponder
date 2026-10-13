# HH field policy

## Source precedence

1. Explicit run instruction.
2. Final CV for the selected market.
3. Read-only fields and platform accounts from the selected repository (`APP_DB=postgres` for SQL, otherwise Noco).
4. Existing confirmed HH values only when the previous sources are silent.

Do not infer salary, citizenship, relocation, commute time, dates, employers, education, language level, or contacts.

## Contacts

- Email: CV, then `login` from the locale `hh_ru`/`hh_en` account.
- About phone: CV, then `phone_en`; omit when neither exists.
- Telegram: CV, then locale Telegram `nickname`.
- Preferred structured contact method: email.
- Keep any About phone visible as CV text, but hide every structured HH phone field.

## Profile structure

- Fill all source-supported personal, experience, education, language and skill fields.
- About order is Contacts, Summary/About, Skills, in the CV language.
- For En, set the resume's own language to English (`In English` / `EN`) in every title variant and
  verify it after reloading. Keep this distinct from site UI language and spoken-language proficiency.
- Preserve CV wording and skill categories.
- In the initial HH wizard always enter and select the Russian profession `Программист, разработчик`,
  regardless of stack or market. Never enter the mapped English title there. After HH assigns the draft ID,
  set the market/stack title from `stack-titles.ts` through the safe partial profession editor.
- Before changing a field, read its current value. Skip exact scalar matches and exact complete sets. Correct
  mismatches only from the final CV or allowed repository fallback. If an already populated field has no approved
  source value, leave it unchanged. Do not duplicate matching experience, education, language, or skill rows.
- En location is always `Tbilisi, Georgia`; En permits are selected by Russian UI labels and are exactly
  `Грузия`, `Сербия`, `Армения`, `Казахстан`.
- For permits, batch-read only checked options and compare the complete selected set. Never traverse every
  country through individual browser calls; click only selected extras and missing required countries. If the
  four-country set already matches, do not change or save the field.
- Business trips are Ready. Work formats are On-site, Remote and Hybrid.
- Apply the SKILL.md hard skill condition: exactly 30 distinct source-supported structured tags in
  category rounds, all Advanced, persisted and independently verified for every resume.

## Resumes and visibility

- After each publication, set HH's job-search status to `Активно ищу работу` and verify persistence.
  This is independent of database workflow status and active/searchable resume publication.

- Create all configured titles for the resolved stack and market with identical content. If a filled
  primary-title baseline already exists, preserve it, create only missing variants with HH's native
  `Duplicate` action, and reuse matching incomplete drafts.
- Prepare ordinary builds and native duplicates as drafts. Rename copies through the partial position editor.
  After content/privacy verification, finish publication for every mapped title and require active, searchable
  HH server state. Drafts are checkpoints; they are not a completed production fill.
- Visibility is everyone except selected employers.
- Required exclusions come from read-only database `current_company`, `previous_companies`, and
  `stop_list_company`. Retain provenance. CV/context and supported experience-description documents
  supply disambiguating context only; do not add extra employers or brands from them.
- Search each database-sourced candidate. Add only one unambiguous official card; skip missing or ambiguous matches and include the reason in the report.

## Persisted city, education and experience

- Read the selected city label from the actual location control or its dedicated saved editor.
  A hidden numeric area ID is an internal identifier, not the city name. Never compare it to a city
  string or guess its meaning. Distinguish a different city from an unreadable field; reopen to verify.
- Preserve every education record explicitly supported by the final CV. When Bachelor and Master
  are both present, add/select both as separate records, even at the same institution. Master must
  not replace Bachelor. Do not invent Bachelor when only Master is stated. Compare degree taxonomy
  consistently in filling and verification (Bachelor/Bachelor of Science/bachelor's/bakalavr in the
  relevant language; Master/magistr), while checking institution, specialty and year independently.
  Read individual education cards, not their shared container. Report the mismatching field.
- Include ALL CV experience entries, with no fixed count. Match employer, role and dates so multiple
  roles at one employer remain distinct. Reuse existing records and preserve unrelated saved entries.
  Verify selected membership in each exact target resume and persisted content after reopening.
- Inspect the actual destination after every wizard transition. If experience redirects to the known
  skill-level step, verify the required skills, save their levels, finish that step, and reopen experience.
  Never interpret a redirect as missing employment history. Do not create duplicate profile records.
  Unknown screens or explicit validation errors require diagnosis; completing experience may publish,
  so leave that final action until the full content/privacy contract passes.

## Employer matching and preservation

- Database company fields are not normalized. Resolve names using their source context, explicit aliases,
  legal-name/brand variants, and official HH card details. Only the three database fields create candidates;
  an organization mentioned solely in CV/context is not an additional exclusion. Do not select an unrelated substring match.
  Skip a missing or ambiguous official card with a recorded reason and continue the fill.
- Scope employer reads to the employer selector/list. Phone/anonymity and other privacy controls are
  never employer entries. Preserve existing employer selections and verify every newly saved selection.
  A failed save is distinct from a company that could not be found.
- Retain immutable original observations. If an earlier reader recorded a demonstrably unrelated UI
  caption as an employer, retain the original and an explicit correction record; exclude only the proven
  caption and preserve all genuine employers. Never reset observations merely to make checks pass.

- On the observed draft wizard, experience selection cards can omit company names. Match the exact
  role, dates and description, reject ambiguous matches, and verify companies/full content in saved
  profile experience cards. Require selection persistence for the exact draft ID before accepting this
  pre-publication evidence. After publication, verify the resume's own content. A profile record alone
  never proves membership. Normalize Present/current employment without inventing an end date.
- HH may render a city combobox or skills screen before loading saved values. Wait for hydration;
  read the city control's displayed selected label when its search input is empty. Never use header
  vacancy-search fields. A successful education save may return to the profile overview; reopen the
  dedicated education editor and verify the saved record rather than requiring one redirect URL.

- Company entry supports an ordinary text input, exact suggestions and an actual visible editor sheet.
  Read the field first; leave matching text unchanged. An absent suggestion does not imply a missing
  popup. Confirm free text through blur when no sheet is visible, then reread the field; a cleared or
  different value is a failure. Keep regressions for each observed variant and save/reopen behavior.

- Treat list bullet glyphs and list-leading hyphens as formatting when comparing experience text;
  still verify every word, date and metric. If the observed work editor has no separate location field,
  retain the CV's location/remote wording in the existing description without discarding its text.
  Reopen and verify it, and make repeated recovery idempotent. After safe partial edits, complete any
  known pending skills step and recheck exact-draft experience selection before the publication gate.

- After publication, the creation wizard is no longer the residence reader. Read the saved Where you live
  card in the applicant profile, scoped to its observed label/control; never substitute About text or the
  header vacancy-search city. Treat Russian/English Tbilisi labels as the same verified location.
- Wait for the employer dialog and search control to mount before reading them. Verify preservation
  against the reopened saved exclusion list; an existing excluded employer need not remain searchable
  in the public directory. Directory matching is required for new database-sourced candidates.

- A native copy can require profession confirmation that immediately publishes it. Keep its recorded
  source/target IDs, and verify copied experience/education on the copy's own resume pages before
  activation. Never substitute the baseline or profile records for copy content. Do not submit the
  profession prerequisite from experience preparation; only the gated activation adapter may do so.
  Persist copy provenance for recovery and reuse the recorded ID without another clone request.

- The contacts editor can show email/preferred-contact controls before the formatted phone hydrates.
  Allow bounded read retries before declaring a mismatch; never rewrite a matching phone merely
  because an initial read was empty. Persistent source mismatches still block publication.

- For language verification, wait for the dedicated saved language cards and compare each exact
  language/level pair. Do not search the footer/site-language control or interpret an unhydrated editor
  as a changed language. Missing/ambiguous cards are unreadable evidence; a visible wrong level is a mismatch.

- A failed publication-status GET is not proof of an inactive resume. Retry known transient reads
  within a bound. After repeated HTTP 406, use a fresh task-owned read page for the exact resume ID,
  leaving the publishing wizard in place. Never repeat a publication click/POST to recover a failed
  status read, and close only the temporary page created for this read.
