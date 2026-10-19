import { createReadSession } from "../../integrations/postgres/read-session.mts";
import { createRequire } from "node:module";
import { writeTransaction } from "../../integrations/postgres/working-session.mts";
import type {
  CopyDatabase,
  SqlPool,
} from "../../integrations/postgres/contracts.mts";
import type { Client } from "./policy.ts";
import type { Store } from "./worker.ts";
const { selectTelegramGroupChatId } = createRequire(import.meta.url)("../../../shared/telegram-group-chat.ts") as {
  selectTelegramGroupChatId(client: Record<string, unknown>): unknown;
};
const str = (value: unknown) => String(value ?? "").trim();
// pg returns Date objects; String(Date) would discard their milliseconds.
const date = (value: unknown) =>
  value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
const personal = [
  ["first_name", "Имя"],
  ["last_name", "Фамилия"],
  ["fio", "ФИО полностью"],
  ["birth_date", "Дата рождения"],
  ["english_levels_id", "Уровень английского"],
  [
    "ready_for_interview_in_english_in_2_months",
    "Готовность к собеседованию на английском",
  ],
  ["real_location", "Реальная локация"],
  ["desired_location", "Желаемая локация"],
  ["calendar_email", "Личный email"],
  ["telegram_personal_chat_id", "Личный Telegram"],
] as const;
export function clientLifecycleStore(pool: SqlPool, database: CopyDatabase) {
  const read = createReadSession(pool, database);
  const write = <T,>(operation: Parameters<typeof writeTransaction<T>>[2]) =>
    writeTransaction(pool, database, operation);
  const delivery: Store = {
    async claim(key, clientId, kind, points, at, expectedStatus, expectedClient) {
      return write(async (session) => {
        const current = await session.query(
          `SELECT id FROM noco.clients c WHERE id=$1 AND client_status=$2
          AND NOT COALESCE(__nc_deleted,false)
          AND ($3::jsonb IS NULL OR jsonb_build_array(
            btrim(COALESCE(client_role,'')),btrim(COALESCE(NULLIF(btrim(to_jsonb(c)->>'secured_general_chat_id'),''),telegram_general_chat_id::text,'')),
            btrim(COALESCE(telegram_personal_chat_id,'')),btrim(COALESCE(google_folder,'')),
            btrim(COALESCE(tg_hard_mentor,'')),btrim(COALESCE(client_name,'')),
            CASE WHEN market_id IN (1,2,3) THEN market_id ELSE NULL END
          )=$3::jsonb) FOR UPDATE`,
          [clientId, expectedStatus, expectedClient ? JSON.stringify([
            expectedClient.role,expectedClient.chatId,expectedClient.tag,expectedClient.googleFolder,
            expectedClient.hardMentor,expectedClient.name,
            ({ru:1,en:2,both:3})[expectedClient.market!] ?? null,
          ]) : null],
        );
        if (!current.rows.length) return "stale";
        if (kind === "reminder") {
          const recent = await session.query(
            `SELECT event_key FROM noco.client_notifications
            WHERE client_id=$1 AND kind='reminder' AND (
              outcome IN ('claimed','uncertain') OR
              (outcome='sent' AND (sent_at IS NULL OR sent_at>$2::timestamptz-interval '48 hours'))
            ) LIMIT 1`,
            [clientId, at.toISOString()],
          );
          if (recent.rows.length) return false;
          const reset = await session.query(`SELECT id FROM noco.client_status_history
            WHERE client_id=$1 AND old_status IS DISTINCT FROM new_status
              AND new_status IN ('hh_ru process','hh_both process','hh_en process')
              AND changed_at>$2::timestamptz-interval '48 hours' LIMIT 1`,[clientId,at.toISOString()]);
          if (reset.rows.length) return "stale";
        }
        const claimed = (
          (
            await session.query(
              `INSERT INTO noco.client_notifications
        (event_key,client_id,kind,points,attempted_at) VALUES($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT(event_key) DO UPDATE SET outcome='claimed',attempted_at=EXCLUDED.attempted_at,
          points=EXCLUDED.points,message_id=NULL,error_code=NULL,retry_at=NULL
        WHERE client_notifications.outcome='failed'
          AND COALESCE(client_notifications.retry_at,'-infinity'::timestamptz)<=$5
        RETURNING event_key`,
              [key, clientId, kind, JSON.stringify(points), at.toISOString()],
            )
          ).rows.length === 1
        );
        if (claimed) return true;
        const existing = (await session.query(
          "SELECT outcome FROM noco.client_notifications WHERE event_key=$1", [key],
        )).rows[0];
        return existing?.outcome === "failed" ? "deferred" : false;
      });
    },
    async finish(key, result) {
      await write(async (session) => {
        const updated = await session.query(
          `UPDATE noco.client_notifications
        SET outcome=$2,message_id=$3,error_code=$4,
          sent_at=CASE WHEN $2='sent' THEN clock_timestamp() ELSE NULL END,
          retry_at=CASE WHEN $2='failed' THEN clock_timestamp()+$5::double precision*interval '1 second' ELSE NULL END
        WHERE event_key=$1 AND outcome='claimed' RETURNING event_key`,
          [
            key,
            result.outcome,
            result.outcome === "sent" ? result.messageId : null,
            result.outcome === "sent" ? null : result.code,
            result.outcome === "failed" && Number.isFinite(result.retryAfterSeconds)
              ? Math.max(1, result.retryAfterSeconds!) : 60,
          ],
        );
        if (updated.rows.length !== 1)
          throw new Error("notification_claim_missing");
      });
    },
  };
  return {
    delivery,
    async activation() {
      return read(async (s) => {
        const r = (
          await s.query(
            "SELECT activated_at,status_cursor FROM noco.client_notification_state WHERE singleton",
          )
        ).rows[0];
        return r
          ? {
              activatedAt: date(r.activated_at),
              statusCursor: String(r.status_cursor),
            }
          : null;
      });
    },
    async clients() {
      return read(async (s) =>
        (
          await s.query(`SELECT c.id,c.client_name,c.client_status,c.client_role,c.market_id,
        c.telegram_personal_chat_id,c.telegram_general_chat_id,c.google_folder,c.tg_hard_mentor,
        to_jsonb(c)->>'secured_general_chat_id' AS secured_general_chat_id,
        c.first_name,c.last_name,c.fio,c.birth_date,c.english_levels_id,c.ready_for_interview_in_english_in_2_months,
        c.real_location,c.desired_location,c.calendar_email,c.education,c.education_entries,c.no_higher_education,c.stop_list_company,
        noco.client_account_indicators(c.id) indicators,
        h.id AS change_id,h.changed_at AS status_changed_at,
        (SELECT max(n.sent_at) FROM noco.client_notifications n WHERE n.client_id=c.id AND n.kind='reminder' AND n.outcome='sent') AS last_sent_at,
        (SELECT max(hh.changed_at) FROM noco.client_status_history hh WHERE hh.client_id=c.id
          AND hh.old_status IS DISTINCT FROM hh.new_status
          AND hh.new_status IN ('hh_ru process','hh_both process','hh_en process')) AS last_hh_transition_at
        FROM noco.clients c LEFT JOIN LATERAL (SELECT id,changed_at FROM noco.client_status_history h
          WHERE h.client_id=c.id AND h.new_status IS NOT DISTINCT FROM c.client_status ORDER BY h.id DESC LIMIT 1) h ON true
        WHERE NOT COALESCE(c.__nc_deleted,false) ORDER BY c.id`)
        ).rows.map((r) => {
          let educationRows: unknown = r.education_entries;
          if (typeof educationRows === "string") {
            try {
              educationRows = JSON.parse(educationRows);
            } catch {
              educationRows = null;
            }
          }
          const hasEducation =
            !!str(r.education) ||
            (Array.isArray(educationRows) &&
              educationRows.some(
                (e) =>
                  e &&
                  typeof e === "object" &&
                  str((e as Record<string, unknown>).uni),
              )) ||
            r.no_higher_education === true;
          const client: Client = {
            id: Number(r.id),
            name: str(r.client_name),
            status: str(r.client_status),
            role: str(r.client_role),
            market:
              ({ 1: "ru", 2: "en", 3: "both" } as const)[
                Number(r.market_id) as 1 | 2 | 3
              ] ?? null,
            tag: str(r.telegram_personal_chat_id),
            chatId: str(selectTelegramGroupChatId(r)),
            googleFolder: str(r.google_folder),
            hardMentor: str(r.tg_hard_mentor),
            indicators: r.indicators as Client["indicators"],
            missingPersonal: personal
              .filter(([key]) => !str(r[key]))
              .map(([, label]) => label),
            missingStopList: !str(r.stop_list_company),
          };
          if (!hasEducation) client.missingPersonal.push("Образование");
          return {
            client,
            statusChangeId: r.change_id == null ? null : String(r.change_id),
            statusChangedAt: r.status_changed_at
              ? date(r.status_changed_at)
              : null,
            lastSentAt: r.last_sent_at
              ? date(r.last_sent_at)
              : null,
            lastHHTransitionAt: r.last_hh_transition_at
              ? date(r.last_hh_transition_at)
              : null,
          };
        }),
      );
    },
    async changes(_cursor: string, now: Date = new Date()) {
      return read(async (s) =>
        (
          await s.query(
            `SELECT h.id,h.client_id,h.old_status,h.new_status,h.changed_at FROM noco.client_status_history h
        CROSS JOIN noco.client_notification_state s
        LEFT JOIN noco.client_notification_events e ON e.history_id=h.id
        WHERE s.singleton AND h.changed_at>s.activated_at
          AND NOT COALESCE(e.done,false) AND (e.retry_at IS NULL OR e.retry_at<=$1)
        ORDER BY h.id LIMIT 500`,
            [now.toISOString()],
          )
        ).rows.map((r) => ({
          clientId: Number(r.client_id),
          id: String(r.id),
          oldStatus: r.old_status == null ? null : str(r.old_status),
          newStatus: str(r.new_status),
          at: date(r.changed_at),
        })),
      );
    },
    async advanceCursor(cursor: string) {
      await write(async (s) => {
        await s.query(
          "UPDATE noco.client_notification_state SET status_cursor=GREATEST(status_cursor,$1) WHERE singleton",
          [cursor],
        );
      });
    },
    async recordChange(id: string, done: boolean, retryAt: Date | null) {
      await write(async s => {
        await s.query(`INSERT INTO noco.client_notification_events(history_id,done,retry_at) VALUES($1,$2,$3)
          ON CONFLICT(history_id) DO UPDATE SET done=client_notification_events.done OR EXCLUDED.done,
          retry_at=EXCLUDED.retry_at`, [id,done,retryAt?.toISOString() ?? null]);
      });
    },
    async beginDay(scheduledAt: Date) {
      await write(async s => {
        await s.query("INSERT INTO noco.client_notification_days(scheduled_at) VALUES($1) ON CONFLICT DO NOTHING",
          [scheduledAt.toISOString()]);
      });
    },
    async pendingDay() {
      return read(async s => {
        const r=(await s.query("SELECT scheduled_at FROM noco.client_notification_days WHERE NOT done ORDER BY scheduled_at LIMIT 1")).rows[0];
        return r ? date(r.scheduled_at) : null;
      });
    },
    async finishDay(scheduledAt: Date) {
      await write(async s => {
        await s.query("UPDATE noco.client_notification_days SET done=true WHERE scheduled_at=$1", [scheduledAt.toISOString()]);
      });
    },
  };
}
