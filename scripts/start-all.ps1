# Starts the whole system with one command: npm run start:all (from the repo root).
# 1. Starts Docker Desktop if it is not running yet.
# 2. Starts PostgreSQL and RabbitMQ and waits until they are healthy.
# 3. Starts the gateway, the Node.js services, the web app and the AI Pipeline (npm run serve:all).
#    The Node.js services run without --watch: a watch restart drops the requests in progress.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Test-Docker {
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

if (-not (Test-Docker)) {
  Write-Host 'Docker is not running. Starting Docker Desktop...'
  Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
  $waited = 0
  while (-not (Test-Docker)) {
    if ($waited -ge 180) { throw 'Docker Desktop did not start within 3 minutes. Start it by hand and run again.' }
    Start-Sleep -Seconds 5
    $waited += 5
  }
  Write-Host 'Docker is running.'
}

docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL or RabbitMQ did not become healthy. See: docker compose ps' }

npm run serve:all
