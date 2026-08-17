# Unipile integration — архитектура

## Роль адаптера

`src/integrations/unipile` — единственная граница между бизнес-фичами и Unipile
V2. Он скрывает URL, payloads, pagination, cache headers и provider errors.
LinkedIn Automation работает с внутренними DTO/ports и не парсит raw Unipile
responses.

## Текущее состояние

В `client.ts` уже есть:

- list/get accounts;
- session auth intent (не подключается к UI до выбора auth strategy);
- чтение и обновление собственного профиля;
- поиск LinkedIn search parameter IDs;
- нормализация rate-limit headers и ограниченная redaction ошибок.

Перед live-использованием требуется исправить два архитектурных ограничения:

1. mutation requests не должны наследовать автоматический rate-limit retry;
2. `Cache-Control: no-cache` не должен безусловно применяться ко всем GET.

## Порты

```text
UnipileAccountsPort       account health и identity
UnipileProfilePort        Profile Filler read/update/read-back
UnipileRelationsPort      people search, invitations, relations
UnipilePostsPort          own posts, comments, replies
UnipileWebhookVerifier    signature verification и event normalization
```

Физически дробить `client.ts` нужно только при реализации соответствующего
порта. Пустые заготовки заранее не создаются.

## Методы V2

| Сценарий | Endpoint |
| --- | --- |
| Account health | `GET /v2/accounts/{account_id}` |
| Own identity/profile | `GET /v2/{account_id}/users/me` |
| Update own profile | `PATCH /v2/{account_id}/users/me` |
| Classic people search | `POST /v2/{account_id}/linkedin/search/people` |
| Search parameter IDs | `GET /v2/{account_id}/linkedin/search/parameters` |
| User profile | `GET /v2/{account_id}/users/{user_id}` |
| Sent invitations | `GET /v2/{account_id}/users/me/relation-requests?type=sent` |
| Send invitation | `POST /v2/{account_id}/users/me/relation-requests` |
| Own posts | `GET /v2/{account_id}/users/me/posts` |
| Post comments | `GET /v2/{account_id}/posts/{post_id}/comments` |
| Comment replies | `GET /v2/{account_id}/posts/{post_id}/comments/{comment_id}/replies` |
| Reply to comment | `POST /v2/{account_id}/posts/{post_id}/comments/{comment_id}` |

Все IDs непрозрачны. `account_id`, user ID, post ID, comment ID и request ID
нельзя конструировать или переносить между аккаунтами.

## Pagination

List/search методы читают страницы до явного окончания (`next_cursor` или
`offset`, согласно конкретному endpoint). Бизнес-код получает либо завершённый
результат, либо ошибку `incomplete`; частичная выдача не используется для
создания мутаций.

## Cache policy

- identity перед binding, account health и mutation read-back: `no-cache`;
- повторяемые read-only каталоги могут использовать default cache или
  ограниченный `max-age`;
- sensitive data, которую нельзя сохранять в Unipile cache: `no-store`;
- адаптер читает `X-Cache` и `Age`, но пишет в telemetry только безопасные
  метаданные;
- cached response не считается доказательным read-back, если операция требует
  свежего provider state.

## Retry policy

- GET может повторяться только для явно классифицированных transient errors;
- POST/PATCH не получает общий automatic retry;
- `api/too_many_requests` обрабатывается по `Retry-After`, но mutation сначала
  reconciles provider state;
- `provider/too_many_requests` останавливает очередь;
- timeout после mutation возвращает `uncertain`, а не `failed`;
- error DTO содержит status, type, reqId и безопасное detail, без auth payload.

## Webhooks

Webhook verifier работает с raw body, проверяет `unipile-signature` через HMAC
SHA-256 и защищается от replay. Нормализованные события являются сигналом для
health check/reconciliation, но не заменяют provider read-back.

Поддерживаемые account events: `account.add`, `account.reconnect`,
`account.status.running`, `.disconnected`, `.errored`, `.paused` и
`account.remove`. Неизвестные event types должны быть forward-compatible.

## Тесты

Каждый новый порт сначала получает fake contract tests:

- pagination и incomplete result;
- per-request cache headers;
- 429 API/provider distinction;
- mutation timeout -> uncertain без второго POST;
- redaction;
- signature verification по raw body;
- provider payload -> internal DTO mapping.

Live tests требуют отдельного разрешения с точным account, действиями и cleanup.

Санитизированная матрица возможностей Profile API:
[PROFILE_CAPABILITIES.md](docs/PROFILE_CAPABILITIES.md).
