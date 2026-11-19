#!/usr/bin/env bash
set -euo pipefail
set -a
source /etc/az-fashion/app.env
set +a
exec node apps/api/dist/server.js
