# LinkedIn Automation

## Цель

`LinkedIn Automation` автоматизирует работу с собственными LinkedIn-профилями
учеников. Управление идёт из существующей Web Console, а все обращения к
LinkedIn выполняются на сервере.

Первая реализованная часть — CLI подключения LinkedIn через Dolphin и Unipile v2.

## Общая схема

```mermaid
flowchart LR
    N["NocoDB: ученики"] --> B["Сервер LinkedIn Automation"]
    D["Dolphin: сохранённая LinkedIn-сессия"] --> C["Local API и CDP: получить куки"]
    C --> B
    B <--> N

    B --> PF["OwnProfileFiller"]
    B --> CI["PeopleConnectionsInvitationSender"]
    B --> CR["OwnPostCommentResponder"]
    B --> PC["Управление постами"]
    N --> PD["Подготовка данных"]
    CUSTOM["Отдельный автор и CV"] --> PD
    PC <--> PD
    PC -->|готовые данные| PW["Writer: writePost(input, model)"]
    PW -->|текст и проверки| PC
    PC <--> PS["Заменяемое хранилище"]
    PC --> PP["Публикация и лайки"]

    PF --> U["Адаптер Unipile"]
    CI --> U
    CR --> U
    PP --> U
    U <--> L["LinkedIn"]

    CV["Резюме ученика: позже"] --> O["OpenAI API"]
    O --> PF
    CR <--> O
    PW <--> MODEL["Переданный клиент модели"]
    MODEL <--> O
```

## Компоненты

| Компонент | Задача |
| --- | --- |
| Подключение аккаунта | Получить куки из Dolphin через CDP, подключить Unipile и проверить владельца профиля |
| Student Admin | Связать ученика, Dolphin-профиль и LinkedIn-аккаунт |
| OwnProfileFiller | Показать и применить подтверждённые изменения собственного профиля |
| PeopleConnectionsInvitationSender | Найти кандидатов и отправить приглашения без повторов |
| OwnPostCommentResponder | Найти новые комментарии к постам ученика и подготовить или отправить ответ |
| Подготовка данных поста | Загрузить CV и собрать готовые факты, данные автора, историю и запреты |
| Writer (OwnPostWriter) | Получить готовые данные и клиент модели, вернуть текст и результаты проверок |
| Управление постами | Вызывать подготовку и Writer; сохранять задания, вести расписание, подтверждение, Stop и прогресс |
| Публикация поста и лайков | Отправить готовый текст через Unipile и проверить результат; выполнить включённые лайки |
| Адаптер Unipile | Скрыть детали внешнего API от бизнес-компонентов |

## Подключение аккаунта

1. CLI находит LinkedIn-строку и единственный Dolphin-профиль с locale `En`.
2. Проверяет обязательный proxy; при отсутствии запрашивает, создаёт и привязывает его в Dolphin.
3. Атомарно блокирует и перезапускает профиль.
4. Через CDP получает только `li_at` и точный `navigator.userAgent`.
5. Создаёт Unipile v2 Auth Intent с продуктом `classic` и прокси Dolphin.
6. Читает собственный профиль, проверяет URL и неизменность provider ID.
7. Сохраняет безопасную связь и статус в `platform_accounts` NocoDB.

Tampermonkey и отдельная форма логина/2FA не используются. Cookie, user-agent и
пароль прокси не сохраняются и не выводятся. `AuthenticationCheckpoint`
восстанавливается вручную в Dolphin.

Подробнее: [DOLPHIN_COOKIE_CONNECTION.md](account-connection/docs/DOLPHIN_COOKIE_CONNECTION.md).

## Общие правила

- Обращения к LinkedIn требуют проверенного `ConnectedAccount`; подготовка текста Post Writer не требует подключения аккаунта.
- Все изменения одного аккаунта выполняются последовательно.
- После изменения выполняется повторное чтение результата.
- Неопределённый результат не повторяется вслепую.
- NocoDB хранит карточки учеников, LinkedIn-привязки и постоянное состояние автоматизации.
- Настройки, задания и история текущих функций находятся в отдельных таблицах NocoDB.
- Управление постами использует заменяемое хранилище; Noco — первый вариант. Сам Writer не работает с БД, файлами и LinkedIn: он получает данные и клиент модели снаружи.
- Оперативный кэш backend не является источником истины.
- Куки и ключи API не попадают в логи, отчёты и интерфейс.

## Структура документов

```text
src/features/linkedin-automation/
  ARCHITECTURE.md
  account-connection/docs/
    DOLPHIN_COOKIE_CONNECTION.md
    ACCOUNT_LIFECYCLE.md
  core/
    safety/LINKEDIN_LIMITS.md
    storage/DATA_BOUNDARIES.md
  profile-filler/
    ARCHITECTURE.md
    docs/QUEUE_FLOW.md
  connection-inviter/ARCHITECTURE.md
  comment-monitor/ARCHITECTURE.md
  post-writer/
    ARCHITECTURE.md
    CONTENT_POLICY.md
  student-admin/ARCHITECTURE.md

src/integrations/unipile/
  ARCHITECTURE.md
```

## Что ещё нужно решить

- Вычитать существующую матрицу возможностей профиля и при необходимости
  повторить проверку через Unipile.
- Утвердить с Полиной и Кирой частоту проверки комментариев.
- Определить, когда ответ ИИ публикуется автоматически, а когда требует подтверждения.
