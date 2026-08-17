# LinkedIn Automation — статус

Актуально на 18 августа 2026 года. Этот файл отделяет реализованный код от
согласованной архитектуры и будущих работ.

| Блок | Статус | Что реально есть | Следующий обязательный шаг |
| --- | --- | --- | --- |
| Shared core | Частично | Контракты аккаунта/jobs, timing, redaction и reporting | Durable storage ports и единый coordinator мутаций |
| Profile Filler | Локальный fake-backed engine | Validation, preview, очередь, последовательное выполнение, read-back; 24 локальных теста | Live Unipile adapter и интеграция с Web Console после отдельного допуска |
| Connection Inviter | Только архитектура | Дневной run, недельный safety budget, постоянная dedup-история и reconnect-сценарий описаны | Fake spike с durable-repository contract |
| Comment Monitor | Только архитектура | Личные посты, 48-часовые watches, comments/replies и режимы ответа описаны | Fake poller и repository contract |
| Student Admin | Только архитектура | Панель учеников, binding аккаунта, desired/actual feature state и archive flow описаны | Backend contracts без изменения NocoDB |
| Account Connection | Решение заблокировано | Описаны два заменяемых варианта | Выбрать Tampermonkey или собственную авторизацию + 2FA |
| Unipile integration | Частично | Accounts, session intent, own profile update и search parameters | Разделить безопасные GET и mutation policies; добавить relations/posts ports |
| Production/VDS | Не начато | Нет deployment и публичного auth | Отдельное security/deployment решение |

## Уже зафиксированные решения

- существующая Web Console — единственный интерфейс;
- NocoDB остаётся источником учеников, существующие таблицы пока не меняются;
- runtime-состояние автоматизации требует отдельного долговечного хранилища;
- Connection Inviter стартует не чаще одного раза в день, соблюдает недельный
  safety budget и проверяет общую историю перед каждой отправкой; отдельной
  недельной очереди или недельного списка нет;
- Comment Monitor работает только с личными постами и не копирует их в NocoDB;
- все мутации последовательны в рамках аккаунта и подтверждаются read-back;
- timeout после возможной отправки означает `uncertain`, а не автоматический
  повтор;
- после reconnect используется тот же `accountId`, затем выполняются health
  check, проверка identity и reconciliation; catch-up пачки нет.

## Блокеры live-режима

1. Не выбран способ подключения и восстановления LinkedIn-сессии.
2. Не выбран и не мигрирован Application DB.
3. Текущий общий Unipile client разрешает rate-limit retry и для mutation
   методов; до live-запуска mutation retry должен стать запрещённым по
   умолчанию.
4. Нет общего account-level mutation coordinator для всех LinkedIn-фич.
5. Нет production-auth Web Console, webhook verification, CSRF/HTTPS и
   server-side secret storage.

До закрытия этих пунктов документация не является заявлением о готовности к
live LinkedIn automation.
