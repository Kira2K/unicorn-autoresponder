import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { canonical, parse } from './json.mts';
import type { Row } from './contracts.mts';
export async function save(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, canonical(value) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function* rows(file: string): AsyncGenerator<Row> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) { if (line) yield parse(line) as Row; }
}
export async function load<T>(file: string): Promise<T> { return parse(await fs.readFile(file, 'utf8')) as T; }
export async function sealArtifacts(directory:string):Promise<void>{
  const entries:{file:string;bytes:number;sha256:string}[]=[];
  async function visit(folder:string):Promise<void>{
    for(const entry of await fs.readdir(folder,{withFileTypes:true})){
      const file=path.join(folder,entry.name);
      if(entry.isSymbolicLink())throw new Error('artifact_symlink_not_allowed');
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&entry.name!=='ARTIFACTS.json')entries.push({file:path.relative(directory,file).replaceAll('\\','/'),
        bytes:(await fs.stat(file)).size,sha256:await hashFile(file)});
    }
  }
  await visit(directory);entries.sort((a,b)=>a.file.localeCompare(b.file));
  await save(path.join(directory,'ARTIFACTS.json'),{createdAt:new Date().toISOString(),files:entries});
  console.log(JSON.stringify({checksummedFiles:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0)}));
}
