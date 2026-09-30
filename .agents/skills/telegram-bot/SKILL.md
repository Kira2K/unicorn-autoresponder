---
name: telegram-bot
description: Develop, diagnose, test, review, or document the shared typed Telegram Bot API integration in hh-autoparcer. Use for sendOne/sendMany behavior, Bot API response typing, command registration and dispatch, protected Telegram send endpoints, logging, sanitization, remote error reporting, or migrations from direct bot sends. Do not use for TDLib user-account dialog automation unless it directly crosses this Bot API facade.
---

# Telegram Bot Integration

## Start here

1. Read `docs/telegram-integration.md` completely before changing behavior.
2. Inspect `src/integrations/telegram/types.ts` before implementation; its public discriminated unions are the consumer contract.
3. Inspect `integration.ts`, `bot-api.ts`, and the closest tests for the requested path.
4. If the task affects CV transitions, also use `$cv-bot` and preserve its workflow invariants.

## Boundaries

- Keep one HTTP/fetch client in `bot-api.ts` and one public facade in `index.ts`.
- Keep the runtime surface limited to `sendOne`, `sendMany`, `commands.register`, and `commands.dispatch`.
- Use type-only exports from `@grammyjs/types`; do not introduce a Telegram framework or parallel Telegram models.
- Preserve complete valid Telegram `ApiResponse` objects, including `ok: false` and unknown fields.
- Represent the absence of a valid Telegram response as a typed `client-failure` stage.
- Never expose credentials, full outgoing text, or token-bearing URLs in logs or reports.
- Keep remote reporting recursion-safe and unable to change the original call result.
- Do not retry business actions because a send outcome is unclear.
- Treat `chatId` only as a Telegram destination ID, never as an application or database ID.
- Use preset `VEU_SUPPORT_BOT`; callers never provide a token. Protected endpoints keep `WEB_CONSOLE_BOT_API_TOKEN`.

## File map

- `src/integrations/telegram/types.ts` — public input/result/command types.
- `src/integrations/telegram/index.ts` — public singleton and type exports.
- `src/integrations/telegram/integration.ts` — facade, validation, classification, batching, commands, reporting.
- `src/integrations/telegram/bot-api.ts` — sole Bot API HTTP/fetch client.
- `src/integrations/telegram/sanitize.ts` — bounded never-throw sanitizer and serialized errors.
- `src/integrations/telegram/integration.test.ts` — runtime and compile-time contract tests.
- `src/features/web-console/backend/app.ts` — protected send endpoints and CV/admin consumers.
- `src/features/web-console/backend/telegram-integration-routes.test.ts` — endpoint/auth/status tests.
- `src/integrations/telegram/support-bot.ts` — command consumer and polling boundary.

## Verification

Run the smallest relevant checks first, then the affected suite:

```powershell
npm run tg:integration:test
npm run tg:support-bot:test
npm run tg:resume:e2e:test
node src/features/web-console/backend/telegram-integration-routes.test.ts
npm run typecheck
```

For a requested live smoke, send only through shared `sendOne`, verify the
returned chat/message IDs, and never print the bot token.
