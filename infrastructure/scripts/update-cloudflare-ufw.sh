#!/usr/bin/env bash
set -euo pipefail

# Keep web access restricted to Cloudflare's published proxy ranges.
# SSH rules are intentionally never touched by this script.
readonly V4_URL="https://www.cloudflare.com/ips-v4"
readonly V6_URL="https://www.cloudflare.com/ips-v6"
readonly TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$V4_URL" -o "$TMP_DIR/ips-v4"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$V6_URL" -o "$TMP_DIR/ips-v6"

for file in "$TMP_DIR/ips-v4" "$TMP_DIR/ips-v6"; do
  test -s "$file"
  grep -Eq '^[0-9a-fA-F:.]+/[0-9]+$' "$file"
done

# Remove only rules previously created by this script, in reverse rule order.
# SSH rules and any unrelated UFW rules are left untouched.
ufw status numbered \
  | sed -n 's/^\[ *\([0-9][0-9]*\)\].*# Cloudflare web.*/\1/p' \
  | sort -rn \
  | while IFS= read -r rule_number; do
      ufw --force delete "$rule_number" >/dev/null
    done

while IFS= read -r cidr; do
  [[ -z "$cidr" ]] || ufw allow from "$cidr" to any port 80 proto tcp comment 'Cloudflare web'
  [[ -z "$cidr" ]] || ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare web'
done < "$TMP_DIR/ips-v4"
while IFS= read -r cidr; do
  [[ -z "$cidr" ]] || ufw allow from "$cidr" to any port 80 proto tcp comment 'Cloudflare web'
  [[ -z "$cidr" ]] || ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare web'
done < "$TMP_DIR/ips-v6"

ufw status verbose
