param(
  [string]$AutoresponsesTaskName = 'HH-Autoresponses-Daily',
  [string]$ProfileFillerTaskName = 'HH-Profile-Filler-Daily',
  [string]$LegacyTaskName = 'HH-Autoresponses-And-Profile-Filler-Daily',
  [datetime]$AutoresponsesFirstRun = [datetime]'2026-09-05T03:40:00',
  [datetime]$ProfileFillerFirstRun = [datetime]'2026-09-05T12:00:00',
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$autoresponsesScript = Join-Path $RepoRoot 'scripts\run-hh-autoresponses-daily.ps1'
$profileFillerScript = Join-Path $RepoRoot 'scripts\run-hh-profile-filler-daily.ps1'
foreach ($script in @($autoresponsesScript, $profileFillerScript)) {
  if (-not (Test-Path -LiteralPath $script)) {
    throw "Daily runner was not found: $script"
  }
}

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12)

$autoresponsesAction = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$autoresponsesScript`""
$autoresponsesTrigger = New-ScheduledTaskTrigger -Daily -At $AutoresponsesFirstRun
Register-ScheduledTask -TaskName $AutoresponsesTaskName -Action $autoresponsesAction `
  -Trigger $autoresponsesTrigger -Settings $settings `
  -Description 'Independent daily HH autoresponses for Ru and En.' -Force | Out-Null

$profileFillerAction = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$profileFillerScript`""
$profileFillerTrigger = New-ScheduledTaskTrigger -Daily -At $ProfileFillerFirstRun
Register-ScheduledTask -TaskName $ProfileFillerTaskName -Action $profileFillerAction `
  -Trigger $profileFillerTrigger -Settings $settings `
  -Description 'Independent daily HH Profile Filler pending queue.' -Force | Out-Null

$legacy = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
if ($legacy) {
  if ($legacy.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $LegacyTaskName
  }
  Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
}

Write-Output "Scheduled $AutoresponsesTaskName daily at $($AutoresponsesFirstRun.ToString('HH:mm')) local time."
Write-Output "Scheduled $ProfileFillerTaskName daily at $($ProfileFillerFirstRun.ToString('HH:mm')) local time."
Write-Output "Removed legacy combined task $LegacyTaskName when present."
