import type { CopyRecord, RecordPage } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';

export async function readPages(read: (after?: string[]) => Promise<RecordPage>): Promise<CopyRecord[]> {
  const records: CopyRecord[] = [], keys = new Set<string>(), cursors = new Set<string>();
  let after: string[] | undefined;
  do {
    const page = await read(after);
    for (const record of page.records) {
      const key = JSON.stringify(record.key);
      if (keys.has(key)) throw new PostgresReadError('duplicate_record');
      keys.add(key); records.push(record);
    }
    if (!page.nextKey) return records;
    const next = JSON.stringify(page.nextKey);
    if (!page.records.length || cursors.has(next) || next !== JSON.stringify(page.records.at(-1)!.key))
      throw new PostgresReadError('invalid_page_cursor');
    cursors.add(next); after = page.nextKey;
  } while (true);
}
