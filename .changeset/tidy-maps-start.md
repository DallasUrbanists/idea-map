---
"@idea-map/web": patch
---

Fix local Nuxt startup returning HTTP 500 when loading the shared authentication
provider module. The server now bundles that module instead of emitting an
incorrect external file path.
