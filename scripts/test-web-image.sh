#!/usr/bin/env bash
set -euo pipefail

# Exercise only a disposable local container with synthetic private settings.
image=${1:-idea-map-web:smoke}
web_id=''
cleanup() {
  if [[ -n "$web_id" ]]; then docker rm -f "$web_id" >/dev/null; fi
}
trap cleanup EXIT

[[ "$(docker image inspect --format '{{.Config.User}}' "$image")" == 'node' ]]
private_value='synthetic-private-web-smoke-value'
web_id=$(docker run -d --publish 127.0.0.1::8080 \
  -e PORT=8080 -e NUXT_API_SECRET="$private_value" \
  -e NUXT_DATABASE_URL='' -e NUXT_MODERATION_REVIEW_ENABLED=false \
  -e NUXT_MODERATION_ACTIONS_ENABLED=false "$image")
address=$(docker port "$web_id" 8080/tcp)
[[ "$address" =~ ^127\.0\.0\.1:[0-9]+$ ]]
ready=false
for _ in {1..40}; do
  if curl --silent --fail "http://$address/api/health" >/dev/null; then ready=true; break; fi
  sleep 0.25
done
[[ "$ready" == true ]]
html=$(curl --silent --fail "http://$address/")
[[ "$html" == *'<h1>Idea Map</h1>'* ]]
[[ "$html" != *"$private_value"* ]]
headers=$(curl --silent --output /dev/null --dump-header - "http://$address/")
grep -iq '^cache-control: private, no-store' <<< "$headers"
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://$address/api/moderation/queue")" == '404' ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' -X POST "http://$address/api/moderation/actions")" == '403' ]]
echo 'Web image health, non-root runtime, private configuration, cache policy, and disabled moderation passed.'
