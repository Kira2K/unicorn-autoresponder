# LinkedIn Automation — границы данных

## Три источника истины

| Система | Что является истиной | Что туда не пишем |
| --- | --- | --- |
| NocoDB | Бизнес-карточки учеников | LinkedIn posts/comments, jobs, dedup history, provider payloads |
| Application DB | Binding, settings, jobs, история и audit | Cookies, passwords, API keys, raw auth/provider payloads |
| Unipile/LinkedIn | Текущее provider-состояние аккаунта, профиля, отношений, постов и комментариев | Наши desired settings и бизнес-история |

Существующие таблицы NocoDB не меняются. Любое будущее изменение их схемы или
данных требует отдельного согласования.

## Минимальная модель Application DB

```text
student_automation_profiles
  student_id PK, archived_at, created_at

linkedin_accounts
  account_id UNIQUE, student_id, verified_identity, verified_at, last_status

student_features
  student_id, feature, desired_state, actual_state, settings
  UNIQUE(student_id, feature)

automation_jobs
  id, account_id, feature, kind, state, idempotency_key, safe_error

daily_runs
  account_id, feature, local_date, state, counters
  UNIQUE(account_id, feature, local_date)

connection_history
  account_id, person_id, state, first_seen_at, request_sent_at, accepted_at
  UNIQUE(account_id, person_id)

post_watches
  account_id, provider_post_id, started_at, expires_at, state
  UNIQUE(account_id, provider_post_id)

comments
  watch_id, provider_comment_id, parent_comment_id, state, sent_reply_id
  UNIQUE(watch_id, provider_comment_id)

automation_events
  account_id, feature, entity_id, event, safe_metadata, created_at
```

Это логическая модель, а не утверждённая миграция. PostgreSQL — подходящий
кандидат, но конкретная СУБД, ORM и migration tool ещё не выбраны.

## Repository ports

Бизнес-фичи зависят от интерфейсов, а не от SQL/Express:

```text
AccountBindingRepository
FeatureSettingsRepository
JobRepository
ConnectionHistoryRepository
PostWatchRepository
CommentRepository
AutomationEventRepository
```

In-memory реализации допустимы только в тестах. Live-run запрещён, если durable
repository недоступен или уникальные ограничения не подтверждены.

## История и защита от спама

- Connection Inviter проверяет всю `connection_history`, а не только текущую
  неделю.
- Недельный safety budget агрегируется из run/action counters. Отдельной
  недельной очереди и отдельного недельного списка коннектов нет.
- `pending`, `accepted` и `uncertain` не удаляются автоматическим cleanup и не
  становятся кандидатами повторно.
- Архивация ученика сохраняет историю.
- Privacy erasure выполняется только отдельной аудируемой командой; обычная
  архивация и retention cleanup её не имитируют.

## Provider data

Профили, посты и комментарии читаются из Unipile по provider IDs. Для работы
разрешено хранить только минимальный snapshot, нужный для dedup, read-back и
аудита. Полные responses не сохраняются «на всякий случай».

Кэширование provider GET управляется на уровне адаптера. Наличие cached response
обязательно различается с доказательным `no-cache` read-back.

## Секреты

API keys, cookies, passwords, TOTP, proxy credentials и webhook secrets живут
только в server-side secret storage. Ссылки/идентификаторы секрета допустимы в
конфигурации; значение секрета — нет.
