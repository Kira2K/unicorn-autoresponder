# LinkedIn Automation — лимиты и расписание

## Принцип

Лимиты считаются на `accountId` сразу для всех LinkedIn-фич. Две очереди не
могут независимо расходовать один provider budget.

```text
Scheduler
  -> AccountMutationCoordinator
     -> daily/weekly budget
     -> per-action budget
     -> cooldown / account health
     -> один последовательный mutation slot
```

Точные ограничения LinkedIn и рекомендации Unipile меняются и зависят от типа,
возраста и активности аккаунта. Поэтому внешние числа не зашиваются как
«разрешённый максимум» в бизнес-код. Перед live-запуском значения сверяются с
Unipile Dashboard и официальной страницей Provider Restrictions.

## Connection Inviter

- scheduler создаёт максимум один run в локальный календарный день аккаунта;
- run работает внутри недельного server-side budget;
- перед claim проверяется постоянная история `accountId + personId`;
- дневной лимит никогда не увеличивается из-за пропущенного дня;
- приглашения отправляются последовательно со свежими случайными интервалами;
- один ежедневный запуск не означает burst: его действия распределяются внутри
  разрешённого рабочего окна;
- приглашения с note имеют отдельный более строгий budget.

`dailyLimit`, `weeklyLimit`, timezone, working window и note budget задаются
только доверенной конфигурацией. UI может запросить изменение, но backend
проверяет его против hard safety ceiling.

## Остальные действия

Profile reads, profile writes, invitations, comments/replies и reactions имеют
отдельные счётчики, но также расходуют общий account budget. Приоритет:

1. health check и reconciliation;
2. обязательный read-back уже начатой мутации;
3. пользовательски подтверждённая Profile Filler job;
4. Comment Monitor reply;
5. новые connection invitations.

Это не позволяет низкоприоритетной очереди вытеснить доказательную проверку.

## Расписание

- интервалы генерируются на backend криптографическим RNG;
- фиксированные секунды и синхронный запуск всех аккаунтов запрещены;
- ежедневный start получает jitter, а действия распределяются по рабочим
  часам;
- hourly Comment Monitor означает целевой интервал с jitter, а не запуск ровно
  в `HH:00`;
- после restart scheduler восстанавливает state из БД, но не создаёт catch-up
  burst.

## Ошибки и stop rules

| Сигнал | Действие |
| --- | --- |
| `api/too_many_requests` + корректный `Retry-After` | Для безопасного GET можно ждать header + новый cushion 5–20 секунд; mutation повторять только после reconciliation |
| `api/too_many_requests` без usable `Retry-After` | Остановить run |
| `provider/too_many_requests` | Остановить account queue и отправить на manual review |
| `disconnected`, invalid authorization, lock/challenge | Немедленно закрыть новые mutation slots |
| Timeout/transport error после возможной мутации | `uncertain`, затем read-back; blind retry запрещён |
| Hard safety ceiling достигнут | Остановить новые действия до следующего окна |

Каждая фича и весь аккаунт имеют server-side kill switch. Увеличение лимита не
обходит provider error, cooldown, disconnect или manual hold.

Официальные источники:

- [Rate Limits](https://developer.unipile.com/v2.0/docs/rate-limits)
- [Provider's Restrictions](https://developer.unipile.com/v2.0/docs/provider-limits-and-restrictions)
- [Manage invitations](https://developer.unipile.com/v2.0/docs/linkedin-manage-invitations)
- [Manage Cache](https://developer.unipile.com/v2.0/docs/caching)
