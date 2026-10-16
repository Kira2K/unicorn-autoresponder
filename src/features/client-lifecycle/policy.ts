/** TAS-143: scheduling/recipient policy. No DB, ENV, HTTP, or writes here. */
export const CLIENT_STATUSES = [
  "onboarding",
  "studying",
  "hh_ru process",
  "hh_both process",
  "on ru market",
  "hh_en process",
  "on en market",
  "paused",
  "graduated",
  "blacklisted",
  "left",
] as const;
export const ACCOUNT_KINDS = [
  "phone_en",
  "phone_ru",
  "hh_en",
  "hh_ru",
  "linkedin",
  "telegram_en",
  "telegram_ru",
  "email_en",
  "email_ru",
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export type Indicator =
  | "заполнен"
  | "не заполнен"
  | "не применимо"
  | "маркет не указан";
export type Client = {
  id: number;
  name: string;
  status: string;
  role: string;
  market: "ru" | "en" | "both" | null;
  tag: string;
  chatId: string;
  googleFolder: string;
  hardMentor: string;
  indicators: Record<AccountKind, Indicator>;
  missingPersonal: string[];
  missingStopList: boolean;
};
export type StatusChange = {
  id: string;
  oldStatus: string | null;
  newStatus: string;
  at: Date;
};
export type MessagePlan =
  | {
      kind: "send";
      key: string;
      chatId: string;
      tag: string;
      stage: string;
      missing?: string[];
    }
  | { kind: "error"; key: string; clientId: number; fields: string[] }
  | { kind: "skip"; reason: string };
const text = (value: string) => value.trim();
const tag = (value: string) =>
  /^[A-Za-z0-9_]{5,32}$/.test(text(value).replace(/^@/, ""));
const errorFields = (client: Client) =>
  [
    !/^-?\d+$/.test(text(client.chatId)) ? "чат ученика" : "",
    !tag(client.tag) ? "Telegram ученика" : "",
    !text(client.role) ? "роль" : "",
  ].filter(Boolean);
export function planStatusMessage(
  client: Client,
  change: StatusChange,
  activatedAt: Date,
): MessagePlan {
  const key = `status:${change.id}`;
  if (
    !Number.isFinite(change.at.getTime()) ||
    !Number.isFinite(activatedAt.getTime())
  )
    return {
      kind: "error",
      key,
      clientId: client.id,
      fields: ["дата смены статуса"],
    };
  if (
    change.at <= activatedAt ||
    change.oldStatus === change.newStatus
  )
    return { kind: "skip", reason: "not_a_current_new_transition" };
  if (
    ![
      "onboarding",
      "hh_ru process",
      "hh_both process",
      "hh_en process",
    ].includes(change.newStatus)
  )
    return { kind: "skip", reason: "no_status_template" };
  const fields = errorFields(client);
  if (!client.role.trim())
    return { kind: "error", key, clientId: client.id, fields };
  if (!["ученик", "клиент"].includes(client.role))
    return { kind: "skip", reason: "role_not_enabled" };
  if (change.newStatus === "onboarding") {
    if (!text(client.googleFolder)) fields.push("Google Drive");
    if (client.role === "ученик" && !tag(client.hardMentor))
      fields.push("TG хард-ментора");
  }
  return fields.length
    ? { kind: "error", key, clientId: client.id, fields }
    : {
        kind: "send",
        key,
        chatId: client.chatId.trim(),
        tag: "@" + client.tag.trim().replace(/^@/, ""),
        stage: change.newStatus,
      };
}
const labels: Record<AccountKind, string> = {
  phone_ru: "Российский номер телефона",
  phone_en: "Иностранный номер телефона",
  email_ru: "Почта для российского рынка",
  email_en: "Почта для иностранного рынка",
  telegram_ru: "Telegram для российского рынка",
  telegram_en: "Telegram для иностранного рынка",
  linkedin: "Аккаунт LinkedIn",
  hh_ru: "Профиль hh.ru (российский)",
  hh_en: "Профиль hh.ru (иностранный)",
};
const basicRu: AccountKind[] = ["phone_ru", "email_ru", "telegram_ru"];
const basicEn: AccountKind[] = [
  "phone_en",
  "phone_ru",
  "linkedin",
  "telegram_en",
  "telegram_ru",
  "email_en",
  "email_ru",
];
const hhStatuses = new Set([
  "hh_ru process",
  "hh_both process",
  "hh_en process",
]);
export function isReminderWindow(now: Date): boolean {
  return (
    Number.isFinite(now.getTime()) &&
    new Date(now.getTime() + 3 * 3600000).getUTCHours() === 19
  );
}
export function planReminder(
  client: Client,
  state: {
    now: Date;
    activatedAt: Date;
    statusChangedAt: Date | null;
    lastSentAt: Date | null;
    lastHHTransitionAt?: Date | null;
    statusChangeId: string | null;
    /** Only a previously scheduled daily check may be completed after its window. */
    scheduledAt?: Date;
  },
): MessagePlan {
  if (client.role !== "ученик")
    return { kind: "skip", reason: "only_students" };
  if (
    ![
      "onboarding",
      "studying",
      "hh_ru process",
      "hh_both process",
      "on ru market",
      "hh_en process",
      "on en market",
    ].includes(client.status)
  )
    return { kind: "skip", reason: "status_not_enabled" };
  if (!Number.isFinite(state.now.getTime()))
    return { kind: "skip", reason: "invalid_clock" };
  const scheduledAt = state.scheduledAt ?? state.now;
  const key = `reminder:${client.id}:${
    state.statusChangeId ?? "baseline"
  }:${Number.isFinite(scheduledAt.getTime()) ? scheduledAt.toISOString().slice(0, 10) : "invalid"}`;
  const fields = errorFields(client);
  if (!client.market) fields.push("маркет");
  if (
    client.market === "ru" &&
    ["hh_both process", "hh_en process", "on en market"].includes(client.status)
  )
    fields.push("несовместимые статус и маркет");
  if (
    (client.status === "onboarding" || hhStatuses.has(client.status)) &&
    !state.statusChangedAt
  )
    fields.push("дата смены статуса");
  if (
    !Number.isFinite(state.activatedAt.getTime()) ||
    (state.statusChangedAt &&
      !Number.isFinite(state.statusChangedAt.getTime())) ||
    (state.lastSentAt && !Number.isFinite(state.lastSentAt.getTime())) ||
    (state.lastHHTransitionAt && !Number.isFinite(state.lastHHTransitionAt.getTime()))
  )
    fields.push("неверная дата истории");
  if (
    ACCOUNT_KINDS.some(
      (kind) =>
        ![
          "заполнен",
          "не заполнен",
          "не применимо",
          "маркет не указан",
        ].includes(client.indicators?.[kind]),
    )
  )
    fields.push("индикаторы аккаунтов");
  if (fields.length) return { kind: "error", key, clientId: client.id, fields };
  // Moscow is UTC+3 with no daylight saving time. The cron window is exactly 19:00–19:59.
  if (!isReminderWindow(scheduledAt) || scheduledAt > state.now)
    return { kind: "skip", reason: "outside_moscow_window" };
  const floor = Math.max(
    state.lastSentAt?.getTime() ?? 0,
    state.lastHHTransitionAt?.getTime() ??
      (hhStatuses.has(client.status) ? state.statusChangedAt!.getTime() : 0),
  );
  if (state.now.getTime() - floor < 48 * 3600000)
    return { kind: "skip", reason: "cooldown" };
  if (
    client.status === "onboarding" &&
    state.now.getTime() - state.statusChangedAt!.getTime() < 7 * 86400000
  )
    return { kind: "skip", reason: "onboarding_grace" };
  const kinds: AccountKind[] = [
    ...(client.market === "ru" ? basicRu : basicEn),
  ];
  if (!["onboarding", "studying"].includes(client.status)) kinds.push("hh_ru");
  if (["hh_en process", "on en market"].includes(client.status))
    kinds.push("hh_en");
  const missing = [
    ...client.missingPersonal,
    ...(client.missingStopList ? ["Стоп-лист компаний"] : []),
    ...kinds
      .filter((kind) => client.indicators[kind] === "не заполнен")
      .map((kind) => labels[kind]),
  ];
  return missing.length
    ? {
        kind: "send",
        key,
        chatId: client.chatId.trim(),
        tag: "@" + client.tag.trim().replace(/^@/, ""),
        stage: "reminder",
        missing,
      }
    : { kind: "skip", reason: "complete" };
}
