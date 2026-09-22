# Адаптер Unipile

## Роль

`src/integrations/unipile` — единственная граница между бизнес-компонентами и
Unipile API. Бизнес-логика не знает URL, формат ответов и ошибки внешнего
сервиса.

```mermaid
flowchart LR
    D["li_at + user-agent + proxy Dolphin"] --> A["Аккаунты"]
    F["LinkedIn Automation"] --> A
    F --> P["Профиль"]
    F --> R["Связи"]
    F --> C["Посты и комментарии"]
    A --> U["Unipile API"]
    P --> U
    R --> U
    C --> U
```

## Части адаптера

| Порт | Ответственность |
| --- | --- |
| Аккаунты | Auth Intent v2, переподключение, состояние аккаунта и проверка владельца |
| Профиль | Чтение, изменение и контрольное чтение собственного профиля |
| Связи | Поиск людей, приглашения и состояние связей |
| Посты и комментарии | Собственные посты, комментарии, ответы и контрольное чтение |

## Правила

`invitation-withdrawal.ts` читает все отправленные ожидающие приглашения с
`created_at` и отзывает выбранное через V2 `POST .../relation-requests/:id/cancel`.
`sent-invitations.ts` проверяет полноту страниц. Неверный или неполный ответ
блокирует отзыв; POST автоматически не повторяется.

- Для LinkedIn передаются `li_at`, точный user-agent, `products: ["classic"]` и обязательный proxy.
- Подключение: `POST /v2/auth/intent`; проверка: `GET /v2/accounts/{id}` и `GET /v2/{id}/users/me`.
- `account_id` передаётся при reconnect; автоматический прокси Unipile запрещён.
- DataImpulse `gw.dataimpulse.com` передаётся как HTTPS: v2 возвращает `api/proxy_error` при SOCKS5.
- Секреты принимаются только как кратковременный вход на сервере.
- Интерфейс никогда не вызывает Unipile напрямую.
- Для списков читаются все страницы.
- Чтение можно повторять только при безопасной временной ошибке.
- Изменения не получают общий автоматический повтор.
- Потеря ответа после изменения возвращается как `uncertain`.
- Адаптер возвращает внутренний понятный формат и безопасные ошибки, а не полный
  ответ Unipile.

## Observed method budgets

`request-budget.ts` shares observed cooldowns within the backend by API base,
account, HTTP method and normalized resource route (pagination does not create
a new budget). A 429 or a successful response with zero remaining quota prevents
further HTTP requests to that method until its reset. Different methods/accounts
remain independent. Invitation POST additionally checks availability of its
mandatory pending-list read-back. No external writes are automatically replayed.

Only numeric Retry-After/rate-limit headers and safe request IDs enter diagnostics.
Unipile V2 reset headers are relative seconds; never interpret them as epoch time.
Cooldowns are process-local; feature retry deadlines and uncertain results remain
in SQL. This is not a global quota reservation across separate deployments.
