import { linkLabBaseQuery } from './base-query.mts';

/** Additive, read-only view. No source data, triggers, IDs or app metadata change. */
export const linkLabViewSql = `CREATE VIEW noco."LinkLab"
WITH (security_invoker = true, security_barrier = true) AS
${linkLabBaseQuery}`;

/** RESTRICT intentionally refuses removal if another object starts using this view. */
export const linkLabViewRollbackSql = 'DROP VIEW noco."LinkLab" RESTRICT';
