# HH field policy

## Source precedence

1. Explicit run instruction.
2. Final CV for the selected market.
3. Read-only fields and platform accounts from the current authoritative PostgreSQL repository, verified by the source preflight. NocoDB and stale database copies are not fallback sources.
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
- English is mandatory. Resolve its level in this order: an explicit level in the final CV, the
  `clients -> English level` relation from the selected repository, then `B2` when both sources are silent.
  Normalize only unambiguous CEFR/native equivalents; never let the repository overwrite a valid CV level.
- Extract every language explicitly stated in the final CV. Add non-English languages only when the CV also
  states a recognized level; skip a language whose level is absent or ambiguous. Preserve existing HH languages
  that are not present in the approved sources, and never create duplicate language rows.
- Read language cards only inside the `Языки` section. The current HH card can have no `data-qa` or pencil:
  its language name and level are sibling nested blocks, and the whole row with the chevron is clickable.
  Treat `B2 — Средне-продвинутый` as the saved CEFR value `B2`; when a saved level differs, open the editor
  by clicking the card itself.
- To add a missing language in HH, click the `Добавить` control scoped to the `Языки` section. In the modal,
  open the first dropdown, fill the search field inside its opened list, and choose the exact language result.
  Open the second dropdown and choose the exact `A1…C2` or `Родной` level, then click the modal's
  `Сохранить`. Wait for the modal to close, read the section cards again, verify the saved language and level,
  and only then continue profile filling. Never treat either dropdown as a text input and never use the
  page-footer `Выбор языка сайта` control.
- About order is Contacts, Summary/About, Skills, in the CV language.
- Preserve CV wording and skill categories.
- On the HH experience wizard, treat profile experience cards and resume membership as separate state.
  Add every missing CV experience to the profile, then select exactly the source-backed cards for the
  current resume. Match cards by normalized company name, verify their real checkbox state, reload the
  experience step, and require the same selection to persist. Text existing elsewhere on the page is not
  proof that the experience belongs to the resume. Never finish or report a resume whose required
  experience cards are absent or unchecked.
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
- Require exactly 30 unique persisted HH skill tags, with Advanced saved for every one of the same 30.
  Preserve existing tags; add only source-supported exact catalog names or approved aliases such as
  Postgres/PostgreSQL, Kafka/Apache Kafka, AWS EKS/AWS (EKS), REST/REST API. Do not invent skills or use
  unrelated suggestions. Exhaust source-backed catalog candidates before reporting insufficient matches.
- Save draft tags through `profile/resume/keyskills?resume=<id>`; published tags through the partial
  `keySkills` editor. Inspect the actual level editor before saving. A five-skill subset cannot satisfy
  the contract. Reopen after saving levels and inspect tags and levels together. If tags disappeared,
  restore and verify the prior saved set and stop; no reduced-count success is permitted.
- Use full bilingual Ru title strings from `stack-titles.ts`, preserving the slash and spelling. En uses
  only English titles. The initial profession/specialization remains `Программист, разработчик`.
- Every En target requires the resume-level `In English` action and a persisted English-language check,
  unless already verified English. The global site language is not evidence of resume language.

## Resumes and visibility

- Follow the [baseline-first sequence](../SKILL.md#resume-title-variants): fully fill, configure privacy
  and verify the primary-title resume before making any duplicates. Then complete and verify each missing
  title variant individually with identical content. Preserve the baseline and reuse matching incomplete drafts.
- Save ordinary builds as drafts. HH may publish a native duplicate when its profession is confirmed;
  permit that only for a verified missing title variant copied from the filled baseline.
- Visibility is everyone except selected employers. Enable Anonymous resume; hide structured phones
  only. Names/photo, email, other contacts and experience must remain visible. Verify all switches.
  Preserve any phone in the About text.
- Stop-list candidates are the union of the comma-separated `clients.stop_list_company` field and employers,
  owners, brands/products, vendors, customers and partners explicitly named in the final CV. Split the PostgreSQL
  field only on commas, trim values, discard empty entries and dedupe without regard to case while preserving
  the first spelling. Do not read `Самопрезентация` or `Описание опыта` documents for Profile Filler.
- Search every employer, owner, brand/product, vendor, customer and partner. Add only one unambiguous official card; skip missing or ambiguous matches and include the reason in local artifacts, not the terminal Telegram message.
- Keep previously selected HH employers even when they are absent from the current sources. Add candidates one
  at a time: select one official card, confirm both employer sheets, save privacy, reopen the direct visibility
  editor, repeat the search and require the checkbox to remain selected. Treat a non-persisted selection as a
  failure. Use only exact normalized names or the maintained official alias allowlist.
- Record blacklist state, hidden-phone state and every candidate outcome separately for every resume. A
  non-empty candidate list with empty accounting is invalid.
