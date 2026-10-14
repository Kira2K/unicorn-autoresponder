# Передача контракта фронтенду

Передайте соседнему агенту всю папку `frontend-contract` и `POSTMAN_RENDER.md`.
`openapi.json` — контракт FastAPI; `api-types.ts` — типы запросов и ответов;
`api-client.ts` — типизированный fetch-клиент. Секретов в этих файлах нет.
В общем локальном workspace достаточно дать агенту абсолютный путь к папке.

После изменения backend-моделей обновите экспорт:

```powershell
.\.venv\Scripts\python.exe scripts\export_frontend_contract.py
```

Экспорт не запускает сервер и не загружает .env. Ограничения длины, диапазоны
и required-поля описаны в OpenAPI; комбинации ZIP/город/сессии — в
POSTMAN_RENDER.md. TypeScript не заменяет runtime-валидацию.

## Локальная проверка

1. Запустите API, если он ещё не запущен:

```powershell
cd C:\Users\kiras\proxy_checker_client
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8002 --env-file .env
```

2. Проверьте `http://127.0.0.1:8002/health` и `/docs`.
3. Запустите frontend dev-server отдельно. Браузерный запрос с другого порта
   напрямую к API сейчас блокируется CORS: backend не включает CORSMiddleware.
   Используйте frontend dev proxy и относительные запросы `/api/v1/...`.

Если фронтенд на Vite, добавьте в существующий vite.config.ts:

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:8002',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
      timeout: 900000,
      proxyTimeout: 900000,
    },
  },
},
```

[Официальная настройка Vite proxy](https://vite.dev/config/server-options.html#server-proxy).
Для Next.js или другого framework настройте аналогичный server-side proxy.

```ts
import { callProxyApi } from './api-client';
const result = await callProxyApi('/api', '/v1/proxies/best', {
  unicorn_proxy_checker_secret_key: serviceKey,
  api_key: nodeMavenKey,
  count: 20,
  location: { country: 'ge', region: 'tbilisi', city: 'tbilisi' },
});
```

Для локального прототипа ключи можно вводить в форму вручную. Общий ключ API
в production должен находиться на backend фронтенда, а не в VITE_*/NEXT_PUBLIC_*
или статическом JS. Production-схема: браузер → backend фронтенда → private API.

Проверьте успешный запрос, отсутствие победителя (`best_proxy=null` при HTTP 200),
ошибки 401/422/429/502, состояние загрузки и отключение повторной отправки.
Два бизнес-endpoint синхронные: ответ может занимать несколько минут.
AbortSignal отменяет ожидание клиента, но не останавливает backend-проверку.
Каждая живая проверка расходует трафик провайдера; для UI-ошибок используйте mocks.
Прямые запросы Postman не ограничиваются браузерным CORS.

`/v1/proxies/best` returns BestProxyResponse (best_proxy only, no results array).
`/v1/proxies/check` returns CheckResponse. All candidate checks remain unchanged.

## Exact catalogue geography

Pass region/city codes verbatim (1–200 characters), including `/`, apostrophes
and Unicode. Do not lowercase, trim or replace characters. Control characters
are rejected. Region/city must be selected when the corresponding catalogue
level has options. Country-only/city-only requests are no longer accepted in
that case; no automatic parent-region lookup occurs. ZIP remains an alternative.

Example: `{ country: 'es', region: 'basque_country', city: 'donostia_/_san_sebastian' }`.
HTTP 422 `provider_location_invalid` means an unknown/missing hierarchy selection.
A gateway/geo failure returns an explicit error without choosing another location.
BestProxyResponse remains unchanged and includes only one best_proxy.
