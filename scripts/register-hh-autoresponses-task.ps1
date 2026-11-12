param(
  [Parameter(Mandatory=$true)][ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$AtLocal,
  [Parameter(Mandatory=$true)][string]$EnvFile,
  [string]$Repo,
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$TaskName = 'HH-Autoresponses-Supervised',
  [switch]$Apply
)
$ErrorActionPreference='Stop'
$repoPath=if ($Repo) { [IO.Path]::GetFullPath($Repo) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$envPath=[IO.Path]::GetFullPath($EnvFile)
$nodeFull=[IO.Path]::GetFullPath($NodePath)
if (!(Test-Path -LiteralPath $envPath -PathType Leaf) -or !(Test-Path -LiteralPath $nodeFull -PathType Leaf)) { throw 'Task ENV or Node path is missing' }
$at=[DateTime]::ParseExact($AtLocal,'HH:mm',[Globalization.CultureInfo]::InvariantCulture)
$checkAt=$at.AddHours(-1)
$weekdays=@('Monday','Tuesday','Wednesday','Thursday')
$checkDays=if ($at.Hour -eq 0) { @('Sunday','Monday','Tuesday','Wednesday') } else { $weekdays }
$cli=Join-Path $repoPath 'src/features/hh-responses/supervised/cli.cjs'
$check=Join-Path $repoPath 'src/features/hh-responses/supervised/services-cli.cjs'
if (!(Test-Path -LiteralPath $cli -PathType Leaf) -or !(Test-Path -LiteralPath $check -PathType Leaf)) { throw 'Supervised release is missing' }
$plan=[ordered]@{taskName=$TaskName;principal=[Security.Principal.WindowsIdentity]::GetCurrent().Name;hostTimeZone=[TimeZoneInfo]::Local.Id;atLocal=$AtLocal;checkAtLocal=$checkAt.ToString('HH:mm');days=$weekdays;precheckDays=$checkDays;repo=$repoPath;node=$nodeFull;envFile=$envPath;model='HH_CAPTCHA_MODEL from ENV, default gpt-6.1-sol';apply=[bool]$Apply}
if (!$Apply) { $plan | ConvertTo-Json -Depth 4; exit 0 }
# Real service test under the registration principal before changing any task.
& $nodeFull $check "--env-file=$envPath" '--mode=full'
if ($LASTEXITCODE -ne 0) { throw 'HH services failed; no task was registered' }
$principal=New-ScheduledTaskPrincipal -UserId $plan.principal -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 36) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$powershell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$daily=Join-Path $repoPath 'scripts/run-hh-autoresponses-daily.ps1'
$first=Join-Path $repoPath '.agents/skills/hh-autoresponses/scripts/first-check.ps1'
$action=New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$daily+'" -NodePath "'+$nodeFull+'" -EnvFile "'+$envPath+'"') -WorkingDirectory $repoPath
$checkAction=New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$first+'" -Mode full -NodePath "'+$nodeFull+'" -EnvFile "'+$envPath+'"') -WorkingDirectory $repoPath
$trigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At $at
$checkTrigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek $checkDays -At $checkAt
foreach ($name in @($TaskName,($TaskName+'-Precheck'))) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw "Task already exists: $name. Inspect it before replacing." }
}
$createdCheck=$false
try {
  Register-ScheduledTask -TaskName ($TaskName+'-Precheck') -Action $checkAction -Trigger $checkTrigger -Principal $principal -Settings $settings | Out-Null
  $createdCheck=$true
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
} catch {
  if ($createdCheck) { Unregister-ScheduledTask -TaskName ($TaskName+'-Precheck') -Confirm:$false -ErrorAction SilentlyContinue }
  throw
}
$plan | ConvertTo-Json -Depth 4
