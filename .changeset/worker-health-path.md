---
"@idea-map/worker": patch
---

Expose process liveness at `GET /health` and use it for worker smoke checks to
avoid Cloud Run's reserved URL paths. Update hosted probes to `/health`; the
existing `/healthz` route remains available for local callers.
