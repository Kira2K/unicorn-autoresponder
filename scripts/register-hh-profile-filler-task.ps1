param(
  [string]$TaskName = 'HH-Autoresponses-And-Profile-Filler-Daily',
  [datetime]$FirstRun = [datetime]'2026-09-04T03:40:00',
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$dailyScript = Join-Path $RepoRoot 'scripts\run-hh-daily-with-profile-filler.ps1'
if (-not (Test-Path -LiteralPath $dailyScript)) {
  throw "Daily runner was not found: $dailyScript"
}

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$dailyScript`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $FirstRun
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'HH autoresponses followed by HH Profile Filler in finally.' `
  -Force | Out-Null

Write-Output "Scheduled $TaskName daily at $($FirstRun.ToString('HH:mm')) local time."
