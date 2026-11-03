---
"@idea-map/web": major
"@idea-map/worker": major
"@idea-map/server": major
---

Require explicit provider modes for authentication, media previews, and worker
task delivery. Hosted configurations must select `provider`; local development
can select `offline`. The Google emulator popup uses the explicit
`emulator-popup` browser mode because it loads a networked support script.

`getMediaPreview` callers must pass a mode. Worker recovery also requires
`WORKER_PROVIDER_MODE=provider`. Configure the new settings with the image
update; missing settings make the corresponding integration unavailable.
