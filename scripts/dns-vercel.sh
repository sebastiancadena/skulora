#!/usr/bin/env bash
# Point a Cloudflare-managed zone at this Vercel project (idempotent).
#   CLOUDFLARE_API_TOKEN (Zone → DNS → Edit on the zone) must be set, or present in .env.local.
#   usage: scripts/dns-vercel.sh [domain]   (default: skulora.com)
set -euo pipefail
DOMAIN="${1:-skulora.com}"
[ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f .env.local ] && CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .env.local | cut -d= -f2-)
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
API=https://api.cloudflare.com/client/v4
H=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

ZONE=$(curl -s "${H[@]}" "$API/zones?name=$DOMAIN" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("result") or [];print(r[0]["id"] if r else "")')
[ -n "$ZONE" ] || { echo "zone $DOMAIN not found (token scope?)" >&2; exit 1; }

upsert() { # type name content
  local type=$1 name=$2 content=$3
  local existing
  existing=$(curl -s "${H[@]}" "$API/zones/$ZONE/dns_records?name=$name" | python3 -c 'import sys,json;print(" ".join(r["id"]+":"+r["type"] for r in json.load(sys.stdin).get("result") or []))')
  local body="{\"type\":\"$type\",\"name\":\"$name\",\"content\":\"$content\",\"ttl\":1,\"proxied\":false,\"comment\":\"vercel (scripts/dns-vercel.sh)\"}"
  for e in $existing; do
    local id=${e%%:*} t=${e##*:}
    if [ "$t" = "$type" ]; then
      curl -s -X PUT "${H[@]}" "$API/zones/$ZONE/dns_records/$id" -d "$body" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("updated" if d["success"] else d["errors"])'
      return
    else
      # A conflicting record type on the same name (e.g. Cloudflare placeholder AAAA/CNAME) blocks Vercel; remove it.
      curl -s -X DELETE "${H[@]}" "$API/zones/$ZONE/dns_records/$id" >/dev/null && echo "removed conflicting $t on $name"
    fi
  done
  curl -s -X POST "${H[@]}" "$API/zones/$ZONE/dns_records" -d "$body" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("created" if d["success"] else d["errors"])'
}

echo "== $DOMAIN (zone $ZONE)"
printf 'A     @    76.76.21.21 ........ '; upsert A "$DOMAIN" 76.76.21.21
printf 'CNAME www  cname.vercel-dns.com  '; upsert CNAME "www.$DOMAIN" cname.vercel-dns.com
printf 'CNAME outfitter cname.vercel-dns.com '; upsert CNAME "outfitter.$DOMAIN" cname.vercel-dns.com
echo "== verifying with Vercel"
vercel domains verify "$DOMAIN" 2>&1 | grep -v "Vercel CLI" | tail -3 || true
echo "== live check"
for h in "outfitter.$DOMAIN" "$DOMAIN" "www.$DOMAIN"; do printf '%-20s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$h/" || echo 'no answer yet')"; done
