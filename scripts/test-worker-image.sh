#!/usr/bin/env bash
set -euo pipefail

# Exercise only the local image. These synthetic settings cannot reach a real
# database or authenticate to Cloud Tasks; no image is pushed or deployed.
image=${1:-idea-map-worker:smoke}
worker_id=''
cleanup() {
  if [[ -n "$worker_id" ]]; then docker rm -f "$worker_id" >/dev/null; fi
}
trap cleanup EXIT

[[ "$(docker image inspect --format '{{.Config.User}}' "$image")" == 'node' ]]
docker run --rm --entrypoint node "$image" --input-type=module -e "import('@idea-map/server').then(() => {})"
worker_id=$(docker run -d --publish 127.0.0.1::8080 \
  -e WORKER_PROVIDER_MODE=provider \
  -e WORKER_ORIGIN=https://worker.invalid \
  -e TASK_INVOKER_EMAIL=task@synthetic.invalid.gserviceaccount.com \
  -e REPAIR_INVOKER_EMAIL=repair@synthetic.invalid.gserviceaccount.com \
  -e CLOUD_TASKS_QUEUE=projects/synthetic/locations/us-central1/queues/synthetic \
  -e WORKER_DATABASE_URL=postgres://synthetic:synthetic@127.0.0.1:1/idea_map_test_synthetic \
  "$image")
address=$(docker port "$worker_id" 8080/tcp)
[[ "$address" =~ ^127\.0\.0\.1:[0-9]+$ ]]
ready=false
for _ in {1..40}; do
  if curl --silent --fail "http://$address/healthz" >/dev/null; then ready=true; break; fi
  sleep 0.25
done
[[ "$ready" == true ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' -X POST "http://$address/tasks/execute")" == '401' ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' -X POST "http://$address/tasks/repair")" == '401' ]]
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://$address/tasks/execute")" == '404' ]]
echo 'Worker image health, non-root runtime, package load, and unauthenticated requests passed.'
