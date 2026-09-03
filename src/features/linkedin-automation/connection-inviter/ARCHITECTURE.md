# Connection Inviter

## Бизнес-цель

Администратор вручную запускает норму LinkedIn-приглашений без сообщения. Норма зависит от числа
connections и делится строго на 70% recruiters и 30% technical без замещения аудитории.
OpenAI и расписание не используются.

Дневная норма и обе audience-квоты замораживаются после первой успешной проверки аккаунта.
Без выбранного stack безопасный режим выполняет только recruiter-часть и завершается как `partial`;
после выбора stack повторный запуск в тот же день добирает только сохранённый technical-остаток.

Live writer включается только через:

- `LINKEDIN_CONNECTION_WRITER_ENABLED=true`;
- `LINKEDIN_CONNECTION_WRITER_ID=<stable-id>`.

## Поиск и отправка

Каталог содержит столицы и крупные IT-хабы. Сначала по `runId` стабильно перемешиваются крупные
рынки найма, затем резервные города. Ранее использованные города идут в конце своего уровня.

Для каждого города независимо перебираются простые Unipile V2 `keywords`:

- recruiter: Recruiter, Talent Acquisition, Sourcer, HRBP, Human Resources и People-функции;
- technical: aliases stack с Developer, Engineer, Backend Developer, Software Engineer и Tech Lead;
  для GO сначала используется `Golang`, затем `Go`.

В запрос всегда передаётся `network_distance: [2]`. Город является поисковым сегментом и мягким
сигналом политики, но не блокирует кандидата.

Для recruiter и technical сохраняются независимые cursor-потоки с индексом термина. Термин меняется
после отсутствия `next_cursor` либо после двух пустых cursor-страниц подряд; после всех терминов
выбирается следующий город. Последовательность отправок:

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
Серия backoff для `invitation_write` хранится отдельно от активного retry read-back: временный сбой
pending/profile-чтения не сбрасывает накопленный шаг `3 -> 6 -> 12 -> 24 -> 30 минут`.

Invitation POST не повторяется вслепую:

- `429` требует отрицательного pending read-back до повторной отправки;
- после backoff повторный pending/profile preflight и fresh Noco `sending` read-back обязательны;
- timeout, unreachable и `5xx` переводят запись в `uncertain`, повторяется только read-back;
- deterministic `4xx` отклоняет кандидата;
- Noco обязан подтвердить `sending` до mutation.

## Состояние и NocoDB

- `linkedin_connection_search_catalog` — каталог городов.
- `linkedin_connection_runs` — один запуск на `platformAccountId + localDate`.
- `linkedin_connection_history` — lifetime-запись на `accountId + personId`.

Skipped-профили не создают history rows. Lifetime-блокируют только `sending`, `sent`, `pending`,
`accepted` и `uncertain`. Подтверждённые `sent/accepted` history rows являются единственным
источником дневной квоты. Realtime-прогресс передаётся через SSE, а search reservation, фактические
search timestamps, location ID и cursor сохраняются критически для безопасного restart.

`completed` выставляется только при точном совпадении обеих подтверждённых квот. Полное исчерпание
городов даёт `partial / search_exhausted` с точным недобором. Stop сначала проходит через account gate
и выполняет обязательный read-back `sending/uncertain`; повторный invitation POST вслепую запрещён.
Live writer требует стабильный ID. Обычные checkpoints выполняются не чаще раза в 120 секунд;
длинные timer/reservation сохраняются до ожидания и защищают lease без отдельного heartbeat-запроса.
Во всех terminal-состояниях lease освобождается.

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
