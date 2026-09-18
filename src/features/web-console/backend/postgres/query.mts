import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { ConsoleRow } from './contracts.mts';
// Only equality/OR expressions emitted by the existing console repository; never executable SQL.
export function consoleClauses(where: string) {
  return where.split('~or').map(clause => {
    const match = /^\(([A-Za-z_][\w ]*),eq,([^()]*)\)$/.exec(clause);
    if (!match || ['constructor', '__proto__', 'prototype'].includes(match[1]))
      throw new PostgresReadError('sql_console_query_unsupported');
    return { field: match[1], value: match[2] };
  });
}
export function filterRows(rows: ConsoleRow[], where?: string): ConsoleRow[] {
  if (!where) return rows;
  const clauses = consoleClauses(where);
  return rows.filter(row => clauses.some(({ field, value }) => String(row[field] ?? '').trim() === value));
}
