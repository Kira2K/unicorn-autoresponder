import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./run-hh-autoresponses-daily.ps1', import.meta.url));
const precheck = fileURLToPath(new URL('./run-hh-autoresponses-precheck-daily.ps1', import.meta.url));
const quote = (s: string) => s.replaceAll("'", "''");
function run(options: { inherited?: string; dotenv?: string; failure?: number; checkFailure?: number; script?: string }) {
  const repo = mkdtempSync(join(tmpdir(), 'hh-wrapper-'));
  try {
    mkdirSync(join(repo, 'logs')); mkdirSync(join(repo, 'scripts'));
    writeFileSync(join(repo, '.env'), options.dotenv ?? '');
    const check = `Write-Output ('TEST_CHECK:'+$env:APP_DB); exit ${options.checkFailure ?? 0}`;
    // Neither the historical nor replacement precheck may call live services in tests.
    writeFileSync(join(repo, 'logs', 'scheduled-extra-state-check-20260811-034000.ps1'), check);
    writeFileSync(join(repo, 'scripts', 'hh-autoresponses-state-check.ps1'), check);
    const command = `function Get-Date { [datetime]'2026-10-06' }; function npm { Write-Output ('TEST_RUN:'+$env:APP_DB+':'+$env:ORCHESTRATOR_WORK_WITH_MARKET); $global:LASTEXITCODE=if($env:ORCHESTRATOR_WORK_WITH_MARKET -eq 'Ru'){${options.failure ?? 0}}else{0} }; & '${quote(options.script ?? script)}' -AutoresponsesRepo '${quote(repo)}'; exit $LASTEXITCODE`;
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { SystemRoot: process.env.SystemRoot, PATH: `${dirname(process.execPath)};${process.env.PATH ?? ''}`,
        PATHEXT: '.COM;.EXE;.BAT;.CMD', APP_DB: options.inherited ?? '' }
    });
  } finally { rmSync(repo, { recursive: true, force: true }); }
}
for (const scenario of [
  { inherited: '', dotenv: '', expected: 'postgres' },
  { inherited: '', dotenv: 'APP_DB=postgres\n', expected: 'postgres' },
  { inherited: 'postgres', dotenv: 'APP_DB=noco\n', expected: 'postgres' },
  { inherited: 'noco', dotenv: 'APP_DB=postgres\n', expected: 'noco' }
]) test(`same storage in precheck and both markets: ${JSON.stringify(scenario)}`, () => {
  const result = run(scenario);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    `TEST_CHECK:${scenario.expected}`, `TEST_RUN:${scenario.expected}:Ru`, `TEST_RUN:${scenario.expected}:En`
  ]);
});
test('daily HH wrapper continues En after Ru failure and preserves failure status', () => {
  const result = run({ inherited: 'postgres', failure: 7 });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(result.stdout.split(/\r?\n/).filter(line => line.startsWith('TEST_RUN:')),
    ['TEST_RUN:postgres:Ru', 'TEST_RUN:postgres:En']);
});
test('failed precheck prevents both market launches', () => {
  const result = run({ dotenv: 'APP_DB=postgres\n', checkFailure: 1 });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('TEST_RUN:'));
});
test('one-hour precheck uses the same dotenv storage', () => {
  const result = run({ dotenv: 'APP_DB=postgres\n', script: precheck });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['TEST_CHECK:postgres']);
});

test('state checker invokes the shared readiness probe without overwriting storage', () => {
  const stateCheck = readFileSync(new URL('./hh-autoresponses-state-check.ps1', import.meta.url), 'utf8');
  // Evaluate only this function with a fake subprocess; never run the live state checker.
  const definition = stateCheck.slice(stateCheck.indexOf('function Resolve-Readiness'), stateCheck.indexOf('function Test-ScheduledTaskAction'));
  assert.ok(definition.startsWith('function Resolve-Readiness'));
  const command = `${definition}
    $RepoRoot = 'C:\\fake repo'; $ReadinessTimeoutSec = 5; $env:APP_DB = 'postgres'
    function StringOrEmpty($Value) { [string]$Value }
    function Invoke-ExternalProcess($FilePath, $ArgumentList, $TimeoutSec) {
      if ($FilePath -ne 'node.exe' -or $ArgumentList[0] -ne '\"C:\\fake repo\\scripts\\hh-autoresponses-readiness.cjs\"' -or $ArgumentList[1] -ne 'En') { throw 'Wrong readiness command' }
      @{ TimedOut=$false; ExitCode=0; Stdout='{"storage":"postgres","targets":1,"ready":1,"blocked":0}' }
    }
    $result = Resolve-Readiness -Market En
    if ($env:APP_DB -ne 'postgres' -or $result.Storage -ne 'postgres' -or $result.Ready -ne 1) { throw 'Storage changed' }
    Write-Output 'OK'`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), 'OK');
});
