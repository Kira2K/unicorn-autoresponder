import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const WORKFLOW_VERSION='006_noco_workflow';
export const WORKFLOW_TABLES=['collection_runs','vacancy_stacks','application_batches'] as const;
export async function workflowDdl() {
  const sql=(await readFile(new URL('../migrations/006_noco_workflow.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  return {sql,checksum:createHash('sha256').update(sql).digest('hex')};
}
