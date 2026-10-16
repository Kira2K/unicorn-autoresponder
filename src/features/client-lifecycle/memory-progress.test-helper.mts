import type { StatusChange } from "./policy.ts";
/** Faithful in-memory adapter for per-event receipts and persisted daily jobs. */
export function memoryProgress() {
  const events=new Map<string,{done:boolean;retryAt:Date|null}>();
  const days=new Map<string,boolean>();
  return {
    select<T extends StatusChange>(changes:T[],now:Date) {
      return changes.filter(c=>{const e=events.get(c.id);return !e?.done && (!e?.retryAt || e.retryAt<=now)}).slice(0,500);
    },
    async recordChange(id:string,done:boolean,retryAt:Date|null){events.set(id,{done:done || events.get(id)?.done===true,retryAt})},
    async beginDay(at:Date){if (!days.has(at.toISOString())) days.set(at.toISOString(),false)},
    async pendingDay(){const day=[...days].filter(([,done])=>!done).sort()[0]?.[0];return day ? new Date(day) : null},
    async finishDay(at:Date){days.set(at.toISOString(),true)},
  };
}
