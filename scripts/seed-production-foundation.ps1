# Runs the foundation seed (reference data only: roles, permissions, settings, taxonomies, agreements) against the
# production database. Reads PROD_DIRECT_URL from the local .env for this process only and never prints it.
# Every write in the foundation seed is an upsert; users, acceptances, and business records are not touched.
$ErrorActionPreference = "Stop"
$line = Get-Content .env | Where-Object { $_ -match '^PROD_DIRECT_URL=' } | Select-Object -First 1
if (-not $line) { Write-Error "PROD_DIRECT_URL is not set in .env"; exit 1 }
$url = ($line -replace '^PROD_DIRECT_URL=', '') -replace '"', ''
$env:DATABASE_URL = $url
$env:DIRECT_URL = $url
try {
  Write-Host "Seeding foundation data against the production database (connection string not shown)..."
  npm run db:seed:foundation
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
}
