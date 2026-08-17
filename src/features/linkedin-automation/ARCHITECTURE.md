# LinkedIn Automation — архитектура

## Статус

`LinkedIn Automation` — отдельная локальная фича внутри текущего репозитория.
Она объединяет общую панель учеников, lifecycle подключённых аккаунтов и три
независимых блока автоматизации LinkedIn. `Profile Filler` реализован как
локальный fake-backed engine; `Connection Inviter`, `Comment Monitor` и
`Student Admin` пока существуют на уровне архитектуры.

- Локальная ветка: `feature/linkedin-profile-filler-web`.
- Commit, push, PR и deployment без отдельного подтверждения запрещены.
- Способ подключения LinkedIn пока не выбран.
- Аутентификацию пока не реализуем.
- VDS является будущей средой выполнения, а не названием бизнес-фичи.

Точная готовность блоков: [STATUS.md](STATUS.md).

## Расположение

```text
src/features/linkedin-automation/
  ARCHITECTURE.md
  AGENTS.md
  STATUS.md
  core/
    account/
      connected-account.ts
    jobs/
      job-types.ts
    safety/
      timing-policy.ts
      redaction.ts
      LINKEDIN_LIMITS.md
    storage/
      DATA_BOUNDARIES.md
    reporting/
      step-result.ts
      logger.ts
  account-connection/
    docs/
      AUTHENTICATION_OPTIONS.md
      ACCOUNT_LIFECYCLE.md
  student-admin/
    ARCHITECTURE.md
  connection-inviter/
    ARCHITECTURE.md
  comment-monitor/
    ARCHITECTURE.md
  profile-filler/
    ARCHITECTURE.md
    types.ts
    validator.ts
    profile-snapshot.ts
    planner.ts
    preview-store.ts
    job-manager.ts
    service.ts
    executor.ts
    report.ts
    state.ts
    docs/
      QUEUE_FLOW.md
      PROFILE_JSON.md
    tests/
    fixtures/

src/integrations/unipile/
  ARCHITECTURE.md
  client.ts
  docs/
    PROFILE_CAPABILITIES.md
```

Сейчас runtime Unipile integration сосредоточен в `client.ts`; отдельный
`ARCHITECTURE.md` фиксирует будущие ports и safety gaps. Возможное разделение
на `accounts.ts`, `profile.ts`, `relations.ts`, `posts.ts`, `errors.ts` и
`tests/` выполняется по мере реализации, а не создаётся заранее.

`src/integrations/unipile` остаётся отдельно, потому что это адаптер внешнего
сервиса, а не бизнес-блок Profile Filler.

## Главная схема

```mermaid
flowchart LR
    N["NocoDB: ученики"] --> UI["Существующая Web Console"]
    UI --> API["LinkedIn backend"]
    API <--> DB["Application DB: настройки, jobs, общая история"]

    TM["Tampermonkey"] --> CA["Verified ConnectedAccount"]
    FA["Собственная auth + 2FA"] --> CA
    CA --> LIFE["Account lifecycle"]
    LIFE --> API

    API --> PF["Profile Filler"]
    API --> CI["Connection Inviter"]
    API --> CM["Comment Monitor"]
    PF --> COORD["Account mutation coordinator"]
    CI --> COORD
    CM --> COORD
    COORD --> U["Unipile adapter"]
    U <--> L["LinkedIn"]
    U -->|"read-back / events"| LIFE
```

Один coordinator сериализует мутации аккаунта и расходует общий дневной и
недельный budget. Read-only каталоги могут выполняться параллельно только если
не мешают обязательному read-back активной мутации.

## Граница подключения аккаунта

Следующие блоки не должны знать, как именно был подключён LinkedIn. Они получают
только проверенный результат:

```text
ConnectedAccount
|- accountId
|- displayName
|- profileUrl
`- verifiedAt
```

На границе Unipile поле `account_id` преобразуется во внутреннее `accountId`.

Кандидаты:

- `Tampermonkey`: готовая авторизованная браузерная сессия;
- `Собственная авторизация + 2FA`: собственный credentials/checkpoint flow.

До отдельного решения запрещено реализовывать auth endpoints, формы credentials,
постоянное хранение LinkedIn password/TOTP secret, checkpoint automation и
конкретный reconnect auth flow. Общая реакция приложения на disconnect/recovery
уже определена независимо от способа авторизации. Backend Profile Filler может
временно получать данные текущей LinkedIn-сессии для подключения или
восстановления связи; они не передаются в browser responses, preview или
отчёты.

Подробная схема вариантов: [AUTHENTICATION_OPTIONS.md](account-connection/docs/AUTHENTICATION_OPTIONS.md).
Общий lifecycle: [ACCOUNT_LIFECYCLE.md](account-connection/docs/ACCOUNT_LIFECYCLE.md).

## Компонентные границы

```text
LinkedIn Automation
  -> account connection strategy boundary
  -> shared core
     -> connected account contract
     -> account lifecycle and mutation coordination
     -> job state contracts
     -> timing policy and secret redaction
     -> durable storage ports and common history
     -> common step result
  -> Student Admin
     -> NocoDB student enrollment
     -> verified account binding
     -> desired / actual feature state
     -> archive without history deletion
  -> Profile Filler
     -> validator / normalizer
     -> current-profile reader
     -> diff planner
     -> preview confirmation
     -> in-memory job manager
     -> ordered executor
     -> read-back verifier
  -> Connection Inviter
     -> daily queue and persistent history
  -> Comment Monitor
     -> live personal-post catalog
     -> 48-hour post watches
     -> hourly comments and replies poller
     -> notify / draft / auto-reply policy
     -> send reconciliation and audit
  -> Unipile integration facade
  -> Unipile V2
  -> LinkedIn Classic
  -> existing Web Console integration
```

`core` содержит только общие контракты и политики, которые смогут повторно
использовать блоки LinkedIn Automation. Логика конкретных разделов профиля
остаётся внутри `profile-filler`, дневная очередь приглашений и постоянная
история — внутри `connection-inviter`, а мониторинг постов и комментариев —
внутри `comment-monitor`.

Границы NocoDB/Application DB/Unipile описаны в
[DATA_BOUNDARIES.md](core/storage/DATA_BOUNDARIES.md), общие budgets и stop rules
— в [LINKEDIN_LIMITS.md](core/safety/LINKEDIN_LIMITS.md).

Существующая Web Console является единственным UI: отдельное приложение внутри
`profile-filler` не создаётся. Frontend никогда не обращается напрямую к
Unipile или LinkedIn. Секреты,
provider payloads, очередь, интервалы и read-back находятся на backend.

## Изоляция

Разрешённая область работы:

```text
src/features/linkedin-automation/**
src/integrations/unipile/**
src/features/web-console/**  # только LinkedIn-specific integration points
```

Остальной репозиторий read-only, включая `package.json`, корневую конфигурацию,
NocoDB, HH, Dolphin, Telegram и CV flows. В Web Console разрешены только
минимальные LinkedIn-specific routes, services, views и tests без изменения
поведения существующих разделов.

## Стек

- Node.js и TypeScript;
- Express для backend API;
- Vue 3, Vite и PrimeVue для Web UI;
- Unipile V2 REST API для runtime;
- официальный Unipile MCP только для разработки и проверки документации;
- встроенный `node:crypto` для plan hash, IDs и случайных интервалов;
- fake Unipile responses и Playwright для тестирования.

Новые зависимости и изменения `package.json` до отдельного согласования не
добавляются.

## Unipile MCP

```text
https://developer.unipile.com/mcp?branch=v1.0
```

MCP не участвует в production/runtime потоке. Его `X-API-KEY` передаётся через
secret storage MCP-клиента и никогда не записывается в репозиторий.

## Безопасность

Запрещено логировать, сохранять в отчёты или возвращать во frontend:

- LinkedIn cookies и passwords;
- Unipile API keys;
- proxy username/password;
- полные authentication payloads.

Будущий специализированный auth frontend может принимать и показывать TOTP
secret и одноразовые 2FA-коды. Их нельзя помещать в URL, логи, analytics,
`localStorage`, `sessionStorage`, отчёты или fixtures. После отправки или
истечения срока значение очищается из памяти компонента.

Raw LinkedIn credentials могут кратковременно существовать только на backend и
могут использоваться для session-to-account binding. Они не сохраняются в
отчётах, frontend storage или browser responses. Любой полученный `account_id`
обязательно подтверждается чтением текущей публичной identity.

## Размещение на VDS

VDS — будущая deployment/runtime среда. Конкретные SSH, service, container,
reverse proxy, HTTPS и secret-storage решения сейчас не определяются и не
реализуются. Сначала модуль разрабатывается локально через существующую Web
Console, без deployment.

## Текущий этап

До выбора auth strategy разрешена локальная fake-backed реализация бизнес-логики
без auth UI и без live LinkedIn mutation. Profile Filler уже содержит:

- контракт `profile.json`;
- validator/normalizer;
- diff planner и preview;
- job model и последовательную очередь;
- fake executor и read-back verifier;
- redaction и тесты.

Следующий безопасный этап — fake repositories/coordinators для Connection
Inviter, Comment Monitor и Student Admin. Durable DB, Web Console routes и live
Unipile adapters согласуются отдельно.

Архитектура самого блока: [profile-filler/ARCHITECTURE.md](profile-filler/ARCHITECTURE.md).

Архитектура будущей дневной отправки приглашений:
[connection-inviter/ARCHITECTURE.md](connection-inviter/ARCHITECTURE.md).

Архитектура мониторинга комментариев к личным постам:
[comment-monitor/ARCHITECTURE.md](comment-monitor/ARCHITECTURE.md).

Архитектура панели учеников:
[student-admin/ARCHITECTURE.md](student-admin/ARCHITECTURE.md).

Архитектура внешнего адаптера:
[src/integrations/unipile/ARCHITECTURE.md](../../integrations/unipile/ARCHITECTURE.md).
