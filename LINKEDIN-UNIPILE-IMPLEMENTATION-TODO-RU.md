# LinkedIn / Unipile Implementation TODO

## Status

**Planning reviewed. Pending owner decisions. Implementation not started.**

Целевой runtime — отдельный npm worker для durable LinkedIn layer. Первые технические проверки выполняются через manual CLI/script без production mutations.

Durable LinkedIn state предварительно хранится в Noco. Точная схема определяется отдельным schema/design RFC после технических spikes.

## Goal

Добавить LinkedIn automation через Unipile после CV workflow, не нарушая существующие HH, Telegram, CV и Dolphin workflows.

Целевой V1:

- Dolphin используется для получения и восстановления существующей LinkedIn session.
- Основные LinkedIn actions выполняются через Unipile.
- Profile workflow:

```text
moved to filling
→ LinkedInProfileDraft
→ current profile
→ diff
→ approval
→ update
→ verification
→ filled
```

- `filled` означает: LinkedIn profile успешно обновлён и результат подтверждён повторным чтением.
- Content, Feed и Connections имеют отдельный lifecycle и не блокируют переход CV workflow в `filled`.
- Все production actions проходят через durable state, approval policy, Activity Policy, structured logs, dry-run/preview, pauses и kill switch.
- Provider response считается окончательным успехом только после feature-specific verification, если она технически доступна.

## Current Baseline

- **CONFIRMED:** новые product workflows должны находиться в `src/features/*`, provider integrations — в `src/integrations/*`, reusable runtime — в `src/platform/*`.
- **CONFIRMED:** Noco является live source of truth; Google Sheets остаётся legacy-путём.
- **CONFIRMED:** Web Console уже является основной UI surface; отдельное приложение не требуется.
- **CONFIRMED:** LinkedIn частично представлен через `platform_accounts`, `linkedin_status`, `linkedin_url` и provider `linkedInEmail`.
- **CONFIRMED:** Dolphin binding хранится в `dolphin_profiles`.
- **CONFIRMED:** существующий runtime уже умеет запускать Dolphin profile и подключать Playwright через CDP.
- **SPIKE REQUIRED:** готового helper для извлечения LinkedIn cookies/session из CDP context не найдено.
- **CONFIRMED:** CV workflow доходит до `moved to filling`, но не переходит автоматически в `filled`.
- **CONFIRMED:** durable LinkedIn queue, scheduler, worker и history сейчас отсутствуют.
- **CONFIRMED:** LinkedIn actions должны выполняться через Unipile, а не через Dolphin/browser automation.

## Required Work

### 1. Technical Spikes / Feasibility Checks

#### Spike 1 — Dolphin → Unipile

Проверить read-only flow:

```text
existing Dolphin profile
→ Playwright/CDP context
→ LinkedIn cookies + browser context
→ Unipile account connection
→ account_id
→ GET /users/me
```

Требования:

- использовать существующие Dolphin facade/start/CDP mechanisms;
- работать только с явно выбранным test account;
- получить минимально необходимые session data;
- проверить необходимые cookies, User-Agent и другие требования Unipile connection flow;
- не сохранять cookies/session material в Noco или других durable records;
- не писать session data в logs;
- подтвердить, что `/users/me` возвращает нужного ученика;
- определить reconnect flow для состояния `disconnected`;
- не обходить существующие Dolphin locks и Web Console leases;
- если профиль занят — возвращать retryable `PROFILE_BUSY`.

**Success criterion:**

```text
Dolphin session
→ Unipile account connected
→ expected student returned
→ no secrets persisted
```

#### Spike 2 — Profile API Capability

На test account проверить:

- headline;
- about;
- location;
- experience;
- education;
- skills;
- certifications;
- projects;
- остальные поля LinkedIn guide.

Для каждого поля:

```text
GET BEFORE
→ PATCH
→ GET AFTER
→ compare
```

Результат:

```text
Field | Read | Write | Payload | Status | Notes
```

Статусы:

- `supported`;
- `unsupported`;
- `partial`;
- `unknown`.

Profile Filler может использовать только подтверждённые writable fields.

#### Profile-change Notifications Preflight

Перед любым profile mutation через систему должно быть подтверждено, что LinkedIn sharing уведомлений об изменениях профиля отключён.

```text
OFF     → mutation allowed
ON      → mutation blocked
UNKNOWN → mutation blocked
```

Нужно:

- проверить, можно ли читать или менять эту настройку через Unipile;
- если API-путь не подтверждён — использовать обязательный manual preflight;
- для ручного изменения профиля включить этот шаг в operational checklist;
- если используется cached result — определить короткий TTL;
- логировать только итог `OFF / ON / UNKNOWN`, без session data.

#### Spike 3 — Feed Feasibility

До реализации Feed проверить:

- получение main feed;
- пагинацию;
- стабильность используемого API path;
- идентификаторы постов и авторов;
- возможность надёжного dedupe;
- поведение при изменениях LinkedIn routes;
- доступность verification для likes/comments.

Feed нельзя считать таким же стабильным, как обычные first-class endpoints, пока этот spike не завершён.

### 2. Account / Profile

#### Storage RFC

Durable LinkedIn state хранить в Noco, если schema/design RFC подтвердит пригодность Noco для выбранной модели.

Сравнить:

**Option A — расширить `platform_accounts`:**

- меньше новых сущностей;
- проще existing account relation;
- выше blast radius для существующих UI и workflows.

**Option B — отдельный LinkedIn/Unipile binding:**

- больше новой схемы;
- ниже риск воздействия на существующий `platform_accounts`;
- отдельный lifecycle Unipile connection.

Предварительный V1 default — **Option B**, но решение окончательно принимается только в RFC.

RFC должен определить:

- ownership;
- relations;
- индексы;
- rollback;
- contract-check impact;
- Web Console/API impact;
- queue claim/lease semantics;
- retention;
- recovery зависших records.

#### Account Connection

Нужно:

- хранить связь ученика с `unipile_account_id`;
- хранить connection status, last health check и last error;
- получать рабочий Unipile account по `client_id`;
- поддержать reconnect;
- возвращать `NEEDS_MANUAL_LOGIN`, если LinkedIn разлогинен и в Dolphin;
- не запускать Dolphin profile, если он занят существующей automation или lease;
- не хранить LinkedIn cookies в durable storage.

#### Profile Builder Skill

Создать repo Skill:

```text
linkedin-profile-builder
```

Input:

- approved CV;
- LinkedIn guide.

Output:

```text
LinkedInProfileDraft
```

Skill:

- не придумывает опыт;
- не придумывает компании;
- не придумывает даты;
- не придумывает образование;
- не придумывает навыки;
- помечает спорные данные `NEEDS_REVIEW`;
- выдаёт стабильный structured output;
- не выполняет production actions.

#### Profile Filler

Flow:

```text
moved to filling
→ LinkedInProfileDraft
→ current profile snapshot
→ diff
→ notification preflight
→ durable approval
→ update
→ read-back verification
→ filled
```

Перед mutation сохранить durable redacted evidence:

- фактическое состояние до изменения;
- approved desired state;
- applied diff;
- результат каждого изменяемого поля.

Требования:

- partial failure не переводит workflow в `filled`;
- provider success без read-back не считается полным успехом;
- automatic rollback разрешён только для полей, для которых он протестирован;
- иначе partial failure переводится в `MANUAL_REVIEW`;
- recovery path должен быть понятен по snapshot, diff и logs;
- Content, Feed и Connections не блокируют `filled`.

### 3. Durable Execution Core

Добавить отдельный npm worker.

#### Delivery Semantics

Не обещать `exactly once`.

Использовать:

```text
at-least-once delivery
+
idempotency
+
deduplication
```

Повторный запуск Worker не должен дублировать:

- posts;
- comments;
- replies;
- likes;
- invitations;
- cancels;
- profile mutations.

#### Claim / Lease

Для V1:

- допускается один active Worker instance;
- action должна durable-claim'иться перед выполнением;
- claim имеет lease/heartbeat;
- зависшая `running` action восстанавливается после истечения lease;
- небезопасная для автоматического повтора action переходит в `MANUAL_REVIEW`;
- окончательно исчерпавшие retries actions переходят в permanent failed/dead-letter state.

Если Noco не позволяет безопасно обеспечить claim/lease semantics, RFC должен предложить другой execution store для очереди, сохранив business state в Noco.

#### Action Dependencies

Поддержать последовательные зависимости:

```text
publish post
→ comment 1
→ reply 2
→ reply 3
→ ...
```

Следующий action активируется только после успешного предыдущего.

Ошибка шага:

- блокирует зависимые actions;
- не превращает scenario в success;
- создаёт operational alert.

#### Scheduler / Activity Policy

Scheduler должен учитывать:

- working windows;
- timezone и DST;
- разные timing ranges по action type;
- псевдослучайное распределение внутри заданных границ;
- account history;
- daily/weekly budgets;
- cooldowns;
- missed jobs после downtime;
- catch-up policy;
- no concurrent actions per account;
- provider rate-limit и account-health state.

Целевые объёмы являются **policy caps/targets**, а не обязательством выполнять действия при любом состоянии аккаунта.

#### Approval

Durable approval обязателен для:

- Profile;
- Posts;
- Comments / Replies;
- Feed actions.

Connections:

- high-confidence → auto-schedule;
- low-confidence → human review.

Approval хранит:

- approver;
- approved payload/version;
- target state/version;
- account;
- timestamp;
- expiry.

Stale approval блокирует execution.

Разрешить:

- approval всего `ContentScenario`;
- individual approval каждого Feed action в V1;
- batch Feed approval — позже.

#### Logging / Audit

Structured logs — Definition of Done каждой LinkedIn feature.

По logs и durable history должно быть возможно восстановить:

- account/client;
- action/scenario;
- policy version;
- scheduler decision;
- approval;
- claim/lease;
- execution;
- retry/backoff;
- provider result/error;
- verification.

Критические состояния:

- `NEEDS_MANUAL_LOGIN`;
- `PROFILE_BUSY`;
- `PAUSED`;
- `MANUAL_REVIEW`;
- permanent failure;
- kill switch activation;

должны создавать operational alert в Web Console и/или существующем Telegram reporting.

### 4. Content

#### Post Source

- Посты генерируются пакетно заранее.
- Готовые посты берутся с Google Drive.
- После этого они распределяются по ученикам и расписанию публикаций.
- Перед публикацией пост проходит approval.

Целевые требования:

- **3 posts/week/student**;
- каждый post запускает **4–7 comments/replies, без учёта самого поста**;
- хранить `topic + angle`;
- не повторять уже использованный смысл;
- posts/comments/replies требуют durable approval.

#### ContentScenario

Сценарий должен содержать:

- author;
- participant;
- post;
- thread;
- topic;
- angle;
- dependency order;
- approval state.

Participant selection должен учитывать:

- connected/healthy account;
- pause state;
- доступность;
- профессиональную релевантность;
- историю пар.

Не использовать постоянно одну и ту же пару учеников.

Если participant становится недоступен:

- scenario ставится на hold;
- новый participant не подменяется автоматически без повторной проверки текста и approval.

Если весь ContentScenario заранее утверждён, повторный approve каждого сообщения не требуется, но individual approved payload каждого сообщения должен быть сохранён.

#### Comment Builder

Создать:

```text
linkedin-comment-builder
```

Input:

- target post;
- student data;
- professional context.

Output:

```text
CommentDraft
```

Skill:

- не придумывает опыт;
- не использует пустые generic comments;
- добавляет содержательную профессиональную мысль;
- не выполняет production actions.

### 5. Feed Engagement

Target:

- **5 sessions/week/student**;
- **10–20 posts/session**;
- **1–3 relevant posts/session**.

Relevant:

- possible like;
- possible comment.

Non-relevant:

- selective likes only.

Часть:

- `viewed`;
- `skipped`.

#### Dedupe Lifecycle

Один post имеет lifecycle:

```text
seen
→ classified
→ proposed
→ approved/rejected
→ executed
```

Запрещено:

- повторно выполнять один и тот же like;
- создавать duplicate comment;
- создавать несколько активных proposals одного типа.

Допустимо:

- сначала увидеть post;
- позднее выполнить одно approved действие.

#### Approval

В V1 каждый proposed external action подтверждается отдельно:

- каждый like;
- каждый comment;
- каждый comment payload.

`viewed/skipped` могут фиксироваться автоматически, так как не создают внешнего LinkedIn action.

Batch approval одной feed-session — later phase после накопления истории и подтверждения качества отбора.

### 6. Connection Growth

Target maximum:

- до **10 invitations/day**;
- до **5 days/week**;
- целевой объём — до **50/week**.

Mix:

- **70% recruiters**;
- **30% developers**;
- only **2nd degree**.

Соотношение 70/30 контролировать на weekly/rolling campaign window, а не обязательно внутри каждого дня.

Для V1 invitations отправляются **без персонального текста**.

Resolver должен учитывать:

- рынок;
- location;
- target roles;
- stack;
- existing connections;
- pending invitations;
- уже обработанных кандидатов;
- account/provider state.

Activity Policy должна уменьшать объём для новых, неактивных или ограниченных аккаунтов.

Pending invitation старше 30 дней:

```text
cancel → cancelled_expired
```

Повторный invite тому же человеку требует отдельного cooldown/policy.

Персонализированные invitation messages — later phase; они должны использовать критерии релевантности resolver и отдельный draft/approval flow.

### 7. Web Console / Operations

Расширить существующую Web Console.

Добавить:

- account connection/health;
- Profile Draft/Diff/Approval/Verification;
- durable approval queues;
- individual Feed approval;
- Content Scenarios;
- Connection Campaign;
- actions/history;
- pause/kill switches;
- operational alerts;
- `MANUAL_REVIEW` queue.

Не раздувать существующий `App.vue`; LinkedIn UI выносить в отдельные компоненты/модули.

## Implementation Notes

- Следовать canonical repository docs.
- Не дублировать их правила в этом TODO.
- Unipile requests держать за integration facade.
- LinkedIn orchestration не смешивать с HH orchestrator.
- Existing Dolphin locks/leases не обходить.
- Existing HH/Telegram/CV/Dolphin workflows не переписывать.
- Новый LinkedIn layer проектировать с минимальным blast radius.
- Rollout:

```text
read-only
→ dry-run
→ one test account
→ one action type
→ small group
→ broader rollout
```

## Main Risks

- Cookie/session connection может потребовать другой Unipile auth flow.
- Session может отключиться после logout в исходном Dolphin browser.
- Profile API может поддерживать поля частично.
- Profile notification setting может не иметь API coverage.
- Feed может зависеть от менее стабильного LinkedIn path.
- Noco может оказаться недостаточно подходящим для надёжных claim/lease и recovery semantics.
- Durable state и history потребуют индексов и retention policy.
- Approval volume может стать operational bottleneck.
- Content participant может стать unavailable в середине thread.
- Provider limits различаются между аккаунтами.
- Worker deployment пока не подтверждён.
- Новый Worker не должен влиять на HH runtime.

## Open Questions

### Blockers Before Core Implementation

- Кто approve'ит каждый action type?
- Каков точный список profile fields и acceptance criteria?
- Option A или Option B для Unipile binding?
- Может ли Noco безопасно обеспечить claim/lease semantics для single Worker?
- Какой точный LinkedIn guide используется как source of truth для Profile Builder?

### Blockers Before Automation Rollout

- Где постоянно запускается `npm run linkedin:worker`?
- Какие timezone/working windows использовать?
- Достаточен ли manual Windows connect/reconnect для V1?
- Требуется ли явно сохранённое consent ученика?
- Какой канал использовать для operational alerts?
- Кто и как обрабатывает `MANUAL_REVIEW`?

## Out of Scope for V1

- LLM API.
- Personalized invitation messages.
- Batch Feed approval.
- Advanced SSI/saves/metrics analytics.
- Retention и compaction старой LinkedIn history/logs.
- Несколько concurrent Worker instances.
- Дополнительная оптимизация Activity Policy после безопасного V1.
- Полностью автоматические Profile/Post/Comment/Feed actions без требуемого approval.
- Browser-driven LinkedIn actions через Dolphin.
- Автоматический rollback неподтверждённых profile fields.

## Test Checklist

- [ ] Cookie/session extraction не сохраняет secrets.
- [ ] Connect/reconnect учитывает Dolphin busy/lease state.
- [ ] `/users/me` возвращает ожидаемого ученика.
- [ ] Profile fields имеют evidence matrix.
- [ ] Notification `OFF` разрешает, `ON/UNKNOWN` блокируют.
- [ ] Before snapshot и applied diff сохраняются.
- [ ] Partial profile update не становится `filled`.
- [ ] Claim/lease исключает одновременное выполнение action.
- [ ] Worker восстанавливает expired lease.
- [ ] At-least-once execution не создаёт duplicate external action.
- [ ] Dependency failure блокирует следующие thread actions.
- [ ] ContentScenario approval сохраняет individual payloads.
- [ ] Stale approval блокирует execution.
- [ ] Missed schedule после restart обрабатывается по catch-up policy.
- [ ] Feed lifecycle не создаёт duplicate likes/comments.
- [ ] Feed actions в V1 требуют individual approval.
- [ ] Thread содержит 4–7 comments/replies без учёта post.
- [ ] Participant rotation не использует постоянно одинаковые пары.
- [ ] Connections V1 отправляются без текста.
- [ ] Connection budget адаптируется к account/provider state.
- [ ] Соотношение 70/30 контролируется на campaign window.
- [ ] Pending invitation старше 30 дней отменяется.
- [ ] Critical states создают operational alert.
- [ ] Structured logs восстанавливают execution flow.
- [ ] Secrets не попадают в logs/commits.
- [ ] Existing affected project tests остаются green.

## Implementation Order

1. Dolphin → Unipile read-only spike.
2. Profile API capability + notification preflight spike.
3. Noco schema/design RFC, включая queue claim/lease feasibility.
4. `linkedin-profile-builder` и `LinkedInProfileDraft`.
5. Unipile integration facade + mocked tests.
6. Separate npm Worker: single-instance, dry-run only, claim/lease, recovery, idempotency, logs, pauses и kill switch.
7. Scheduler / Activity Policy в dry-run.
8. Web Console preview/approval/alert surfaces.
9. Profile draft/diff/approval/update/verify flow.
10. `linkedin-comment-builder` и `CommentDraft`.
11. ContentScenario dependencies, approval и participant rotation.
12. Feed feasibility spike.
13. Feed Engagement с individual approval.
14. Connection resolver и adaptive campaign budgets.
15. Pending invitation cleanup.
16. Controlled rollout.
17. LLM API и другие later features после стабилизации V1.
