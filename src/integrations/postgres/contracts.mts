export interface SqlResult { rows: Record<string, unknown>[]; }
export interface SqlSession {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
  release(destroy?: boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlSession>;
  end(): Promise<void>;
}
export type CopyDatabase = 'unicorn_noco_copy' | 'unicorn_noco_copy_restore';
export interface ConnectionOptions {
  host: string; port: number; database: CopyDatabase; user: string; password: string;
  ssl?: { ca: string; rejectUnauthorized: true };
}
export type RecordKey = readonly string[];
export interface CopyRecord {
  key: string[];
  data: Record<string, unknown>;
  /** Exact JSON number literals are preserved even when they cannot fit a JS number. */
  sourceJson: string;
}
export interface TableInfo {
  id: string; title: string; table_name: string; sqlName?: string; sqlTable?: string;
  columns: { id: string; title: string; pk?: boolean; uidt?: string;
    colOptions?: { fk_related_model_id?: string } }[];
}
export interface PageOptions { limit?: number; after?: RecordKey; }
export interface RecordPage { records: CopyRecord[]; nextKey: string[] | null; }
export class PostgresReadError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'PostgresReadError'; }
}
export const COPY_MARKER = 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1';
