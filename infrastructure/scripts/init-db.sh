#!/usr/bin/env bash
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DB_PASSWORD
SELECT format('CREATE ROLE az_app LOGIN PASSWORD %L', :'app_password') \gexec
GRANT CONNECT ON DATABASE az_fashion TO az_app;
SQL
