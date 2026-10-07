param(
  [string]$AutoresponsesTaskName = 'HH-Autoresponses-Daily',
  [string]$ProfileFillerTaskName = 'HH-Profile-Filler-Daily',
  [string]$LegacyTaskName = 'HH-Autoresponses-And-Profile-Filler-Daily',
  [datetime]$AutoresponsesFirstRun = [datetime]'2026-09-05T03:40:00',
  [datetime]$ProfileFillerFirstRun = [datetime]'2026-09-05T12:00:00',
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
throw 'HH Profile Filler is manual-only. Use npm run profile-filler -- --client-id <id> --market ru|en. Scheduled runs and registration are disabled.'
