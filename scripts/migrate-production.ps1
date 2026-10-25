# Applies pending Prisma migrations to the production database (`prisma migrate deploy`, never `migrate dev`).
# Reads PROD_DIRECT_URL from the local .env for this process only and never prints it. Run from the repository root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\migrate-production.ps1
# Take a database backup first whenever a migration drops or rewrites columns (see docs/runbook.md).
$ErrorActionPreference = "Stop"
$line = Get-Content .env | Where-Object { $_ -match '^PROD_DIRECT_URL=' } | Select-Object -First 1
if (-not $line) { Write-Error "PROD_DIRECT_URL is not set in .env"; exit 1 }
$url = ($line -replace '^PROD_DIRECT_URL=', '') -replace '"', ''
$env:DATABASE_URL = $url
$env:DIRECT_URL = $url
try {
  Write-Host "Applying migrations to the production database (connection string not shown)..."
  npx prisma migrate deploy --schema prisma/schema.prisma
  Write-Host "Migration status:"
  npx prisma migrate status --schema prisma/schema.prisma
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
}
