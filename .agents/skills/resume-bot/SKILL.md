---
name: resume-bot
description: Work with the student resume Telegram workflow in hh-autoparcer. Use for questions about a student's resume status, workflow order, current responsible role, required data, or final links; for diagnosing @veu_support_bot commands, access errors, task buttons, and Telegram notifications; for reviewing or changing CV processing transitions, role permissions, protected bot API endpoints, and NocoDB persistence; and for resume workflow tests or documentation updates. Do not use for HH vacancy autoresponse orchestration or unrelated web-console features.
---

# Resume Bot

## Сбор контекста

1. Полностью прочитать `docs/resume-workflow.md` как основную документацию процесса.
2. Не полагаться на сохранённое описание поведения: перед выводами сверять документацию с актуальным кодом.
3. Читать только файлы, относящиеся к задаче, по карте ниже.
4. Если документация расходится с кодом, сообщить пользователю о расхождении и дождаться ответа перед продолжением.

## Карта файлов

- `docs/resume-workflow.md` — команды, роли, статусы, поля NocoDB, API, настройки, тестирование и ошибки.
- `src/integrations/telegram/resume-workflow.ts` — модель статусов, переходы, проверки ролей, обязательные данные и уведомления.
- `src/integrations/telegram/support-bot.ts` — Telegram-команды, callback-кнопки и вызовы защищённого API.
- `src/features/web-console/backend/app.ts` — HTTP endpoint'ы resume workflow и отправка уведомлений.
- `src/features/web-console/backend/repository.ts` — чтение и запись `CV processing` в NocoDB.
- `src/integrations/telegram/support-bot.test.ts` — тесты команд и поведения support-бота.
- `src/integrations/telegram/resume-visible-e2e.test.ts` — изолированные E2E-тесты resume workflow.
- `src/integrations/telegram/resume-visible-e2e.ts` — живой видимый Telegram E2E-сценарий.
- `src/features/web-console/backend/app.test.ts` — тесты защищённого API и переходов.
- `.env.example` — переменные `RESUME_WORKFLOW_*` и связанные настройки.
- `package.json` — команды запуска и тестирования.

## Выбор файлов по задаче

- Для вопроса о порядке работы прочитать документацию и `resume-workflow.ts`.
- Для вопроса о Telegram-команде прочитать `support-bot.ts` и соответствующий тест.
- Для вопроса об API прочитать `app.ts`, `app.test.ts` и типы backend.
- Для вопроса о данных или статусе в NocoDB прочитать `repository.ts` и схему `CV processing`.
- Для изменения поведения прочитать весь путь от команды до NocoDB и затронутые тесты.

## Инварианты

- Считать `CV processing.status` источником истины для статуса резюме.
- Сохранять продвижение ровно на один этап за действие.
- Сохранять разграничение ролей ученика, Киры, основного подрядчика и переводчика русской версии.
- Не записывать фиктивные ссылки и комментарии в обычном режиме.
- Не включать `RESUME_WORKFLOW_FAKE_DATA_MODE` в production или ручной приёмке.
- Не запускать живой `tg:resume:e2e:test-user` на реальных аккаунтах без явного запроса пользователя.
- Перед любой живой операцией проверить режим (`test` или `production`), конкретного клиента и Telegram-чат.

## Изменения и проверка

1. Вносить минимальные изменения в нужный слой.
2. Обновлять `docs/resume-workflow.md`, если меняются команды, статусы, роли, поля, API или процедура тестирования.
3. Запускать ближайшие целевые тесты; для более широких изменений использовать команды из раздела `Automated Tests` документации.
4. В отчёте указывать изменённый переход, ответственного, хранилище данных и выполненные проверки.
