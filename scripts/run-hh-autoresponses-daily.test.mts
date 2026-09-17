import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./run-hh-autoresponses-daily.ps1', import.meta.url));
for (const selected of ['', 'noco', 'postgres']) test(`daily HH wrapper preserves selected storage: ${selected || 'default'}`, () => {
  const command = `function npm { Write-Output ('TEST_STORAGE:'+$env:APP_DB+':'+$env:ORCHESTRATOR_WORK_WITH_MARKET); $global:LASTEXITCODE=0 }; & '${script.replaceAll("'", "''")}' -AutoresponsesRepo '${process.cwd().replaceAll("'", "''")}'`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, APP_DB: selected }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [`TEST_STORAGE:${selected || 'noco'}:Ru`, `TEST_STORAGE:${selected || 'noco'}:En`]);
});
test('daily HH wrapper continues En after Ru failure and returns the original failure', () => {
  const command = `function npm { Write-Output ('TEST_RUN:'+$env:APP_DB+':'+$env:ORCHESTRATOR_WORK_WITH_MARKET+':'+($args -join ' ')); $global:LASTEXITCODE=if($env:ORCHESTRATOR_WORK_WITH_MARKET -eq 'Ru'){7}else{0} }; & '${script.replaceAll("'", "''")}' -AutoresponsesRepo '${process.cwd().replaceAll("'", "''")}'; exit $LASTEXITCODE`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, APP_DB: 'postgres' }
  });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(result.stdout.split(/\r?\n/).filter(line => line.startsWith('TEST_RUN:')),
    ['TEST_RUN:postgres:Ru:run orchestrator', 'TEST_RUN:postgres:En:run orchestrator']);
});
