param([string]$ReportDirectory = 'D:\Unicorn\local-artifacts\octo-render-package-review-20261027-b7f1a6e8')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskCache = Join-Path (Split-Path $taskRoot -Parent) 'tools\use-dev-cache.ps1'
if (Test-Path -LiteralPath $taskCache) { . $taskCache }
$taskId = 'octo-render-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
$taskVolume = $taskId + '-state'
function Invoke-Docker([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments) {
    $taskOutput = & docker @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Docker command failed: ' + ($Arguments -join ' ') + ': ' + ($taskOutput -join "`n")) }
    return ($taskOutput -join "`n")
}
function Wait-Smoke {
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(45)
    $taskStartedAt = Invoke-Docker @('inspect', '--format', '{{.State.StartedAt}}', $taskId)
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        $taskLines = Invoke-Docker @('logs', '--since', $taskStartedAt, $taskId)
        if ($taskLines -match '"backendReady":true') { return }
        $taskRunning = Invoke-Docker @('inspect', '--format', '{{.State.Running}}', $taskId)
        if ($taskRunning -ne 'true') { throw 'Mock container exited before readiness' }
        Start-Sleep -Milliseconds 500
    }
    throw 'Mock readiness timeout'
}
Push-Location -LiteralPath $taskRoot
try {
    Invoke-Docker @('build', '--platform', 'linux/amd64', '-t', 'unicorn-octo-render:local', '.') | Out-Null
    Invoke-Docker @('build', '--platform', 'linux/amd64', '-f', 'docker/smoke/Dockerfile', '-t', 'unicorn-octo-render:smoke', '.') | Out-Null
    Invoke-Docker @('volume', 'create', $taskVolume) | Out-Null
    Invoke-Docker @('run', '-d', '--name', $taskId, '--network', 'none', '--memory', '512m', '--memory-swap', '512m',
        '--cpus', '0.5', '--mount', "type=volume,src=$taskVolume,dst=/var/data", 'unicorn-octo-render:smoke') | Out-Null
    Wait-Smoke
    $taskJournal = Invoke-Docker @('exec', $taskId, 'cat', '/var/data/bridge/journal.json') | ConvertFrom-Json
    $taskDevice = $taskJournal.deviceId
    Invoke-Docker @('restart', '--time', '30', $taskId) | Out-Null
    Wait-Smoke
    Invoke-Docker @('kill', '--signal', 'KILL', $taskId) | Out-Null
    Invoke-Docker @('start', $taskId) | Out-Null
    Wait-Smoke
    $taskAfter = Invoke-Docker @('exec', $taskId, 'cat', '/var/data/bridge/journal.json') | ConvertFrom-Json
    if ($taskAfter.deviceId -ne $taskDevice) { throw 'Journal identity changed on container replacement/restart' }
    $taskCalls = Invoke-Docker @('exec', $taskId, 'cat', '/var/data/bridge/smoke-calls.jsonl')
    if ($taskCalls -match 'poll|authorize|profiles/password' -or $taskCalls -match '"method":"POST"') { throw 'Check mode attempted work' }
    $taskMemory = Invoke-Docker @('stats', '--no-stream', '--format', '{{.MemUsage}}', $taskId)
    $taskBefore = [DateTime]::UtcNow
    Invoke-Docker @('stop', '--time', '30', $taskId) | Out-Null
    $taskSeconds = ([DateTime]::UtcNow - $taskBefore).TotalSeconds
    if ($taskSeconds -ge 27) { throw 'Shutdown exceeded the designed bound' }
    $taskState = Invoke-Docker @('inspect', '--format', '{{json .State}}', $taskId) | ConvertFrom-Json
    if ($taskState.OOMKilled -or $taskState.ExitCode -ne 0) { throw 'Mock exited with OOM or failure' }
    New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
    [ordered]@{ passed=$true; mock_only=$true; real_octo_memory_verified=$false; device_preserved=$true;
        no_jobs_claimed=$true; graceful_and_forced_restart=$true; shutdown_seconds=$taskSeconds;
        mock_memory=$taskMemory; container=$taskId; volume=$taskVolume } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ReportDirectory 'docker-smoke.json') -Encoding utf8
    # Targets are exact, freshly generated names; remove only after confirmed stop.
    Invoke-Docker @('rm', $taskId) | Out-Null
    Invoke-Docker @('volume', 'rm', $taskVolume) | Out-Null
    Write-Output 'Linux mock lifecycle passed. This is not a real Octo memory result.'
} catch {
    # Stop only this freshly named fixture; retain its container/volume for diagnosis.
    & docker inspect $taskId *> $null
    if ($LASTEXITCODE -eq 0) { & docker stop --time 30 $taskId *> $null }
    Write-Output "Failure evidence preserved in stopped container $taskId and volume $taskVolume. No global cleanup is performed."
    throw
} finally { Pop-Location }
