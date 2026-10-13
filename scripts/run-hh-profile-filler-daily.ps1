param(
  [string]$RuntimeRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer',
  [string]$ProfileFillerRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer\.tmp\hh-profile-filling'
)

$ErrorActionPreference = 'Stop'
throw 'HH Profile Filler is manual-only. Use npm run profile-filler -- --client-id <id> --market ru|en. Scheduled runs and registration are disabled.'
