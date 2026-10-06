param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Phase = 'scheduled-t-minus-1h',
  [switch]$CheckPrecheckTask,
  [switch]$SkipTaskChecks,
  [string]$LaunchTaskName = 'HH-Autoresponses-Daily',
  [string]$PrecheckTaskName = 'HH-Autoresponses-Precheck-Daily',
  [string]$LaunchScriptRelative = 'scripts\run-hh-autoresponses-daily.ps1',
  [string]$PrecheckScriptRelative = 'scripts\run-hh-autoresponses-precheck-daily.ps1',
  [string]$OutLogRelative = 'logs\scheduled-precheck-daily.out.log',
  [string]$ErrLogRelative = 'logs\scheduled-precheck-daily.err.log',
  [string]$LaunchDisplay = 'recurring Monday-Thursday 04:40 GMT+3',
  [int]$ReadinessTimeoutSec = 300
)

$ErrorActionPreference = 'Continue'

$LaunchScript = Join-Path $RepoRoot $LaunchScriptRelative
$PrecheckScript = Join-Path $RepoRoot $PrecheckScriptRelative
$OutLog = Join-Path $RepoRoot $OutLogRelative
$ErrLog = Join-Path $RepoRoot $ErrLogRelative
$StateStamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$StateLog = Join-Path $RepoRoot "logs\hh-extra-state-check-$StateStamp-$PID.jsonl"

function Write-OutLog {
  param([string]$Message)
  Add-Content -LiteralPath $OutLog -Value "[$((Get-Date).ToString('o'))] $Message"
}

function Write-ErrLog {
  param([string]$Message)
  Add-Content -LiteralPath $ErrLog -Value "[$((Get-Date).ToString('o'))] $Message"
}

function Shorten {
  param([string]$Value, [int]$MaxLength = 500)
  $text = StringOrEmpty $Value
  if ($text.Length -le $MaxLength) {
    return $text
  }
  return "$($text.Substring(0, $MaxLength))..."
}

function StringOrEmpty {
  param($Value)
  if ($null -eq $Value) {
    return ''
  }
  return [string]$Value
}

function Add-Error {
  param([System.Collections.Generic.List[string]]$Errors, [string]$Message)
  $Errors.Add($Message)
  Write-ErrLog $Message
}

function Get-DotenvValue {
  param([string]$Name)
  $envPath = Join-Path $RepoRoot '.env'
  if (-not (Test-Path -LiteralPath $envPath)) {
    return ''
  }

  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1
  if (-not $line) {
    return ''
  }

  $value = $line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", ''
  $value = $value.Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value.Trim()
}

function Invoke-ExternalProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$TimeoutSec
  )

  $stdoutFile = New-TemporaryFile
  $stderrFile = New-TemporaryFile
  $process = $null
  try {
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    $completed = $process.WaitForExit($TimeoutSec * 1000)
    if (-not $completed) {
      try {
        $process.Kill()
      } catch {
      }
      return [pscustomobject]@{
        TimedOut = $true
        ExitCode = $null
        Stdout = (Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue)
        Stderr = (Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue)
      }
    }

    $process.WaitForExit() | Out-Null
    $stdoutContent = Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue
    $stderrContent = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) {
      $exitCode = if ([string]::IsNullOrWhiteSpace($stderrContent)) { 0 } else { 1 }
    }

    return [pscustomobject]@{
      TimedOut = $false
      ExitCode = $exitCode
      Stdout = $stdoutContent
      Stderr = $stderrContent
    }
  } finally {
    Remove-Item -LiteralPath $stdoutFile -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stderrFile -ErrorAction SilentlyContinue
  }
}

function Test-DolphinLocalApi {
  $token = Get-DotenvValue -Name 'dolphin_api_token'
  if (-not $token) {
    throw 'missing dolphin_api_token in .env'
  }

  $body = @{ token = $token } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri 'http://localhost:3001/v1.0/auth/login-with-token' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 5 | Out-Null
  return 'OK'
}

function Test-ActiveOrchestrator {
  try {
    $active = @(
      Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction Stop |
        Where-Object {
          $_.CommandLine -match 'src[\\/]+features[\\/]+hh-responses[\\/]+cli[\\/]+orchestrator\.ts' -or
          $_.CommandLine -match 'npm-cli\.js.*run orchestrator'
        } |
        Select-Object ProcessId, CommandLine
    )

    if ($active.Count -gt 0) {
      return [pscustomobject]@{
        Ok = $false
        Status = "ERROR: $($active.Count) active HH orchestrator process(es)"
        Details = ($active | ForEach-Object { "pid=$($_.ProcessId)" }) -join '; '
      }
    }

    return [pscustomobject]@{
      Ok = $true
      Status = 'OK: none detected'
      Details = ''
    }
  } catch {
    $nodeProcesses = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    if ($nodeProcesses.Count -eq 0) {
      return [pscustomobject]@{
        Ok = $true
        Status = "OK: no node processes detected; command-line inspection unavailable: $($_.Exception.Message)"
        Details = ''
      }
    }

    return [pscustomobject]@{
      Ok = $false
      Status = "ERROR: command-line inspection unavailable and $($nodeProcesses.Count) node process(es) exist"
      Details = $_.Exception.Message
    }
  }
}

function Resolve-Readiness {
  param([string]$Market)

  $probePath = Join-Path $RepoRoot 'scripts\hh-autoresponses-readiness.cjs'

    $result = Invoke-ExternalProcess -FilePath 'node.exe' -ArgumentList @(('"' + $probePath + '"'), $Market) -TimeoutSec $ReadinessTimeoutSec
    if ($result.TimedOut) {
      throw "HH target/readiness probe timed out while resolving $Market selected targets"
    }
    if ($result.ExitCode -ne 0) {
      throw "HH target/readiness probe failed for $Market with exit code $($result.ExitCode): $(Shorten ($result.Stderr + $result.Stdout))"
    }

    $text = StringOrEmpty $result.Stdout
    $start = $text.IndexOf('{')
    $end = $text.LastIndexOf('}')
    if ($start -lt 0 -or $end -lt $start) {
      throw "HH target/readiness probe for $Market did not return JSON"
    }

    $jsonText = $text.Substring($start, $end - $start + 1)
    $parsed = $jsonText | ConvertFrom-Json
    if ($null -eq $parsed.targets) {
      throw "HH target/readiness probe for $Market returned unresolved target state"
    }

    return [pscustomobject]@{
      Market = $Market
      Storage = $parsed.storage
      Targets = [int]$parsed.targets
      Ready = [int]$parsed.ready
      Blocked = [int]$parsed.blocked
    }
}

function Test-ScheduledTaskAction {
  param(
    [string]$TaskName,
    [string]$ExpectedScript
  )

  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $actionText = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
    if ($actionText -notlike "*$ExpectedScript*") {
      throw "task action does not reference $ExpectedScript"
    }
    return [pscustomobject]@{
      TaskName = $TaskName
      Ok = $true
      Status = 'OK'
      Details = $actionText
    }
  } catch {
    $result = Invoke-ExternalProcess -FilePath 'schtasks.exe' -ArgumentList @('/Query', '/TN', $TaskName, '/V', '/FO', 'LIST') -TimeoutSec 20
    if ($result.TimedOut -or $result.ExitCode -ne 0) {
      return [pscustomobject]@{
        TaskName = $TaskName
        Ok = $false
        Status = 'ERROR'
        Details = "scheduled task query failed: $(Shorten ($result.Stderr + $result.Stdout))"
      }
    }
    if ((StringOrEmpty $result.Stdout) -notlike "*$ExpectedScript*") {
      return [pscustomobject]@{
        TaskName = $TaskName
        Ok = $false
        Status = 'ERROR'
        Details = "scheduled task action could not be verified against $ExpectedScript"
      }
    }
    return [pscustomobject]@{
      TaskName = $TaskName
      Ok = $true
      Status = 'OK'
      Details = 'verified through schtasks'
    }
  }
}

function Send-SummaryErrorAlert {
  param([string]$Message)

  $jsPath = [IO.Path]::ChangeExtension([IO.Path]::GetTempFileName(), '.js')
  $js = @'
require(process.cwd() + '/node_modules/dotenv').config({ quiet: true })
const { sendTelegramMessage } = require(process.cwd() + '/src/integrations/telegram/messenger.ts')

async function main() {
  const channelId = String(process.env.summary_logs_channel_id || '').trim()
  if (!channelId) throw new Error('summary_logs_channel_id is missing')
  await sendTelegramMessage(channelId, process.env.HH_EXTRA_STATE_ALERT_MESSAGE || '', { parseMode: false })
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
'@

  try {
    Set-Content -LiteralPath $jsPath -Value $js -Encoding UTF8
    $env:HH_EXTRA_STATE_ALERT_MESSAGE = $Message
    $result = Invoke-ExternalProcess -FilePath 'node.exe' -ArgumentList @($jsPath) -TimeoutSec 90
    if ($result.TimedOut -or $result.ExitCode -ne 0) {
      return [pscustomobject]@{
        Sent = $false
        Error = "Telegram summary alert failed: $(Shorten ($result.Stderr + $result.Stdout))"
      }
    }
    return [pscustomobject]@{
      Sent = $true
      Error = ''
    }
  } finally {
    Remove-Item -LiteralPath $jsPath -ErrorAction SilentlyContinue
    Remove-Item Env:\HH_EXTRA_STATE_ALERT_MESSAGE -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutLog) | Out-Null
Set-Location -LiteralPath $RepoRoot

$errors = New-Object System.Collections.Generic.List[string]
$taskChecks = @()
$readiness = @()
$dolphinStatus = 'unchecked'
$orchestratorStatus = 'unchecked'
$telegramDelivery = $null

Write-OutLog "Starting HH extra state check phase=$Phase launch=$LaunchDisplay readinessTimeoutSec=$ReadinessTimeoutSec"

try {
  $dolphinStatus = Test-DolphinLocalApi
} catch {
  $dolphinStatus = "ERROR: $($_.Exception.Message)"
  Add-Error -Errors $errors -Message "Dolphin local API check failed: $($_.Exception.Message)"
}

$orchestrator = Test-ActiveOrchestrator
$orchestratorStatus = $orchestrator.Status
if (-not $orchestrator.Ok) {
  Add-Error -Errors $errors -Message "Unexpected active-orchestrator state: $($orchestrator.Status) $($orchestrator.Details)"
}

foreach ($market in @('Ru', 'En')) {
  try {
    $readiness += Resolve-Readiness -Market $market
  } catch {
    Add-Error -Errors $errors -Message $_.Exception.Message
  }
}

if ($SkipTaskChecks) {
  Write-OutLog 'scheduled task checks skipped for this phase'
} else {
  $taskChecks += Test-ScheduledTaskAction -TaskName $LaunchTaskName -ExpectedScript $LaunchScript
  if ($CheckPrecheckTask) {
    $taskChecks += Test-ScheduledTaskAction -TaskName $PrecheckTaskName -ExpectedScript $PrecheckScript
  }
}

foreach ($taskCheck in $taskChecks) {
  if (-not $taskCheck.Ok) {
    Add-Error -Errors $errors -Message "Scheduled task $($taskCheck.TaskName) is not healthy: $($taskCheck.Details)"
  }
}

if ($errors.Count -gt 0) {
  $message = @(
    'Kira.arbeit()',
    'HH autoresponses state check ERROR',
    "Phase: $Phase",
    'Run: all enabled profiles, Ru then En, limit 120',
    "Launch: $LaunchDisplay",
    "Error: $(($errors.ToArray() | Select-Object -First 4) -join '; ')",
    "Dolphin: $dolphinStatus; active HH orchestrator: $orchestratorStatus.",
    'Existing readiness/summary/client Telegram logic unchanged.'
  ) -join "`n"
  $telegramDelivery = Send-SummaryErrorAlert -Message $message
  if ($telegramDelivery.Sent) {
    Write-OutLog 'summary Telegram error alert sent'
  } else {
    Write-ErrLog $telegramDelivery.Error
  }
} else {
  Write-OutLog 'extra state check OK; no Telegram alert sent'
}

$record = [pscustomobject]@{
  at = (Get-Date).ToUniversalTime().ToString('o')
  kind = if ($errors.Count -gt 0) { 'extra-state-check-error' } else { 'extra-state-check-ok' }
  phase = $Phase
  launch = $LaunchDisplay
  dolphinStatus = $dolphinStatus
  orchestratorStatus = $orchestratorStatus
  readiness = $readiness
  taskChecks = $taskChecks
  errors = $errors.ToArray()
  telegramDelivery = $telegramDelivery
}

($record | ConvertTo-Json -Depth 8 -Compress) | Add-Content -LiteralPath $StateLog
Write-OutLog "extra state check log written: $StateLog"

if ($errors.Count -gt 0) {
  exit 1
}

exit 0
