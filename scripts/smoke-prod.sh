#!/usr/bin/env bash
# Read-only production smoke (GET only). Usage:
#   scripts/smoke-prod.sh [base_url] [expected_short_sha]
# Default base: https://adaptivefit-mobile-production.up.railway.app
set -u
BASE="${1:-https://adaptivefit-mobile-production.up.railway.app}"
SHA="${2:-}"
pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

health=$(curl -s -m 20 "$BASE/api/health")
echo "$health" | grep -q '"status":"ok"' && ok "/api/health status ok" || bad "/api/health: $health"
commit=$(echo "$health" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')
[ -n "$commit" ] && ok "/api/health reports commit $commit" || bad "/api/health has no commit"
if [ -n "$SHA" ]; then [ "$commit" = "$SHA" ] && ok "serving expected $SHA" || bad "serving '$commit', expected $SHA"; fi

loc=$(curl -s -o /dev/null -m 20 -w '%{http_code} %{redirect_url}' "$BASE/")
case "$loc" in 307*sign-in*) ok "/ redirects to /sign-in (anonymous)";; *) bad "/ answered: $loc";; esac

code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$BASE/sign-in")
[ "$code" = 200 ] && ok "/sign-in 200" || bad "/sign-in $code"

prov=$(curl -s -m 20 "$BASE/api/auth/providers")
echo "$prov" | grep -q '"google"' && ok "auth providers lists google" || bad "auth providers: $prov"

hdr=$(curl -sI -m 20 "$BASE/sign-in" | tr 'A-Z' 'a-z')
for h in strict-transport-security x-frame-options x-content-type-options referrer-policy; do
  echo "$hdr" | grep -q "^$h:" && ok "header $h" || bad "header $h missing"
done

echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
