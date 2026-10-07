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
- Stop-list candidates come from CV experience/context and supported files inside the exact
  `Самопрезентация` subfolder whose filename contains `Описание опыта`.
- Search every employer, owner, brand/product, vendor, customer and partner. Add only one unambiguous official card; skip missing or ambiguous matches and include the reason in the report.
