# Подключение LinkedIn через Dolphin CDP

## Решение

Для авторизации используется сохранённая LinkedIn-сессия единственного профиля
Dolphin с locale `En`, связанного с учеником. CLI проверяет его кастомный прокси,
атомарно блокирует профиль, останавливает, запускает через Local API и
подключается по CDP. Tampermonkey и отдельная форма логина/2FA не нужны.

```mermaid
flowchart LR
    D["Профиль Dolphin"] --> L["Dolphin Local API"]
    L --> C["CDP"]
    C --> K["li_at + navigator.userAgent"]
    K --> U["Unipile v2 Classic + proxy"]
    U --> V["Проверка владельца"]
    V --> A["Проверенный аккаунт"]
```

## CLI

```text
npm run linkedin:auth -- --client "Имя" [--platform-account-id ID] --apply
```

Без `--apply` выполняется безопасная проверка NocoDB, En-профиля и прокси. Если
LinkedIn-строк несколько, обязателен `--platform-account-id`. Уже работающий
аккаунт только проверяется; `--force-reauth` принудительно обновляет сессию.
Если proxy не читается, запуск с `--apply` скрыто запрашивает URL, создаёт и
привязывает его в Dolphin, затем перечитывает профиль. Формат:
`http|socks4|socks5://login:password@host:port`.

## Данные

В `platform_accounts` сохраняются account ID/status Unipile, подтверждённые
provider ID, имя и URL владельца, время проверки и безопасный код ошибки.
`li_at`, user-agent и credentials прокси не сохраняются и не выводятся.

Из CDP извлекается только активный `li_at`; `li_a` не используется. URL открытого
профиля сверяется с `linkedin_url` до вызова Unipile. В `finally` CDP закрывается,
Dolphin-профиль останавливается, блокировка снимается.

## Отказы

- отсутствующий/истёкший `li_at`, неверный URL или proxy останавливают подключение;
- reconnect использует прежний `account_id`;
- `AuthenticationCheckpoint` требует ручного восстановления сессии в Dolphin;
- ошибка обновляет только безопасный код/время и не стирает подтверждённую связь.

Состояния аккаунта: [ACCOUNT_LIFECYCLE.md](ACCOUNT_LIFECYCLE.md).
