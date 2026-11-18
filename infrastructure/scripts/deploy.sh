#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose up -d postgres
docker compose run --rm migrate
docker compose exec -T postgres psql -U az_admin -d az_fashion -v ON_ERROR_STOP=1 -f /grants.sql
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api web
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
