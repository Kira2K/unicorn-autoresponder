# Connection Inviter

## Бизнес-цель

Администратор вручную запускает норму LinkedIn-приглашений без сообщения. Норма зависит от числа
connections и делится строго на 70% recruiters и 30% technical без замещения аудитории.
OpenAI и расписание не используются.

Live writer включается только через:

- `LINKEDIN_CONNECTION_WRITER_ENABLED=true`;
- `LINKEDIN_CONNECTION_WRITER_ID=<stable-id>`.

## Поиск и отправка

Каталог содержит столицы и крупные IT-хабы. Порядок городов стабильно перемешивается по `runId`;
сначала используются города, которых ещё не было в прошлых запусках аккаунта.

На каждый город строятся Boolean-запросы:

- recruiter: роли recruiting, sourcing, Talent Acquisition, HRBP и People-функции без stack;
- technical: aliases stack и технические роли; для GO используются `Go OR Golang`.

В запрос всегда передаётся `network_distance: [2]`. Город является поисковым сегментом и мягким
сигналом политики, но не блокирует кандидата.

Для recruiter и technical сохраняются независимые cursor-потоки. Город меняется только после
отсутствия `next_cursor`; ограничения количества страниц нет. Последовательность отправок:

`R, R, T, R, R, T, R, R, T, R`.

После страницы с eligible-кандидатами поиск останавливается. Кандидаты помещаются в небольшую
очередь, после чего выполняется:

`profile preflight -> Noco sending claim -> invitation POST -> pending/profile read-back`.

Только подтверждённый read-back увеличивает счётчик квоты. Новая поисковая страница запрашивается
только когда в очереди нет кандидата для следующего слота.

## Pacing и retry

- Не чаще одного Search-запроса в 60–90 секунд.
- Не более пяти Search-запросов за скользящие десять минут.
- Между подтверждёнными invitation-циклами — случайно 15–180 секунд.
- Search timestamps и оба cursor-потока сохраняются в `search_progress_json`.

Для последовательных Unipile `429` используется backoff с jitter 0–60 секунд:

`3 -> 6 -> 12 -> 24 -> 30 минут`.

`Retry-After` задаёт нижнюю границу, если он больше расчётной. Успешная операция сбрасывает attempt.
Остальные transient-сбои используют общий линейный retry. Stop проверяется не реже раза в секунду.

Invitation POST не повторяется вслепую:

- `429` требует отрицательного pending read-back до повторной отправки;
- timeout, unreachable и `5xx` переводят запись в `uncertain`, повторяется только read-back;
- deterministic `4xx` отклоняет кандидата;
- Noco обязан подтвердить `sending` до mutation.

## Состояние и NocoDB

- `linkedin_connection_search_catalog` — каталог городов.
- `linkedin_connection_runs` — один запуск на `platformAccountId + localDate`.
- `linkedin_connection_history` — lifetime-запись на `accountId + personId`.

Skipped-профили не создают history rows. Lifetime-блокируют только `sending`, `sent`, `pending`,
`accepted` и `uncertain`. Run snapshot сохраняется не чаще раза в 120 секунд, кроме retry, Stop,
critical и terminal transitions. Web Console получает оперативный прогресс через SSE.

`completed` выставляется только после полной подтверждённой квоты. `stopped` возможен только по Stop.
Полное исчерпание всех городов для обязательной аудитории считается критической ошибкой конфигурации
`connection_search_space_exhausted`, а не ложным успешным или partial-результатом.

## Проверка

```powershell
npm run typecheck
npm run linkedin:connections:test
npm run linkedin:connections:e2e
npm run web:test
npm run web:build
git diff --check
```

Все автоматические проверки используют mock-адаптеры. Первый live invitation POST после изменения
требует отдельного подтверждения администратора.
