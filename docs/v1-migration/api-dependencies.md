# V1 frontend API and external dependency inventory

If you're tracing how the predecessor app talked to its backend and other
services, this inventory brings those connections together. These are historical
source observations, not current application requirements. The
[migration overview](README.md) explains the scope and terminology.

The inventory supports [#92][92] and records client-side evidence rather than
backend verification. Baseline: committed
`DallasUrbanists/improvement-map` staging revision
[`ee0552e3348a286b69e2540aa332217cdecd28cb`][ee0552e3348a286b69e2540aa332217cdecd28cb].
Only committed frontend source and its documentation were inspected; the
separate backend, actual provider configuration, deployed commit and runtime
behavior were not verified. The [parity matrix](parity-matrix.md) supplies the
broader route and capability crosswalk. Replacement issue links identify
ownership, not shipped v2 endpoints.

The following contents links navigate within this guide:

- [Base URL and authentication](#base-url-and-authentication)
- [Frontend-used HTTP contracts](#frontend-used-http-contracts)
- [Streetmix workflow](#streetmix-workflow)
- [Presentation HTTP and socket contracts](#presentation-http-and-socket-contracts)
- [Providers, media, and data dependencies](#providers-media-and-data-dependencies)
    - [Identity and abuse controls](#identity-and-abuse-controls)
    - [Maps and geolocation](#maps-and-geolocation)
    - [Overpass geometry and labels](#overpass-geometry-and-labels)
    - [Uploads and thumbnails](#uploads-and-thumbnails)
    - [Embedded designs and speech](#embedded-designs-and-speech)
    - [Boundary and representative datasets](#boundary-and-representative-datasets)
    - [Browser-local data](#browser-local-data)
    - [Offline caching and fonts](#offline-caching-and-fonts)
- [Runbook assumptions and outstanding evidence](#runbook-assumptions-and-outstanding-evidence)

## Base URL and authentication

[Base URL selection][base-url-selection] requires an explicit staging origin and
otherwise uses the configured API origin or production default.
[API headers][api-headers] conditionally attach a browser-configured API key,
Firebase App Check token, and Firebase identifier bearer token; their presence
in a request is not proof of backend authorization. The
[Firebase client][firebase-client] uses email/password and Google login,
observes identity-token changes and checks `staff`, `role` or `roles` claims for
user interface state. The client source does not establish how the backend
enforces those checks. V2 authorization and *data transfer object (DTO)*
boundaries belong to [#15][15] and account/session behavior to [#47][47].

## Frontend-used HTTP contracts

Paths in the following table are relative to the configured API origin unless
stated otherwise. These are the methods, response shapes, and fallbacks used by
the client; server validation and exact response schemas need separate backend
evidence.

| Method and path | Client-observed contract / dependency | V2 owner |
| --- | --- | --- |
| `GET /api/public-improvements/suggestions` | List accepts array or `data`/`items`/`suggestions`; caches results and may fall back to local/seed data on failure. | [#44][44], [#15][15] |
| `GET /api/public-improvements/suggestions/:id`; `GET /api/suggestions/:id` | Detail accepts `data` or bare object; forced refresh uses the latter and accepts `submission`/`data`/bare object. Normal detail may fall back to cached list. | [#45][45], [#15][15] |
| `GET /api/public-improvements/suggestions/:id/representatives?limit=500` | Expects an array; positive integer identifier. | [#62][62], [#65][65] |
| `GET /api/public-improvements/suggestions/:id/boundaries` | Expects `data` array. | [#61][61], [#65][65] |
| `GET /api/public-improvements/suggestions/:id/recommended-actions`; `POST /api/recommendables/match` | Actions expect `data` array; matching sends JSON and expects `data` array. Match uses JSON headers directly rather than `apiHeaders`. | [#63][63], [#65][65] |
| `POST /api/public-improvements/suggestions/upload-url`; `PUT` returned signed URL | Requests JSON `contentType` and `filename`, expects `data.uploadUrl`/`publicUrl`; binary is uploaded directly to the supplied storage URL. | [#16][16], [#50][50] |
| `POST /api/public-improvements/suggestions` | Sends submission JSON and normalizes `data` or bare result; client cache updated. | [#50][50], [#48][48] |
| `POST /api/assist/grammar`, `/api/assist/clarity`, `/api/assist/summarize` | Sends text JSON; summary includes type and length constraints; expects `data.text`. | [#66][66], [#57][57] |
| `GET /playground/recommendables?idea=:id` | Browser navigation from the recommended-actions user interface to the legacy search playground; not a JSON fetch. | [#63][63] |

Evidence: [API client][api-headers] and [playground link][playground-link].

## Streetmix workflow

The [client][client] and [workflow][workflow] use
`/api/suggestions/:id/streetmix`: `GET` current state; `POST` start; `POST`
`/regenerate`; `GET` `/requests/:requestId`; `POST`
`/requests/:requestId/selection`; and `GET` `/thumbnail` for a bounded *Portable
Network Graphics (PNG)* relay. Mutations carry idempotency keys; replacement can
carry `If-Match`; the client preserves pending operation data for retry. Its
author/staff check is user interface behavior, not verified server
authorization. It restricts navigable result URLs to the Streetmix origin. V2
generation, authorization, previews and integration belong to [#70][70],
[#71][71], [#72][72] and [#73][73].

## Presentation HTTP and socket contracts

The [presentation client][presentation-client] uses
`/api/public-improvements/presentation` as a prefix. Enrollment creates a
participant identity/token client-side and stores credentials in tab session
storage; subsequent requests send a participant bearer token and
participant-identifier header, not the ordinary `apiHeaders`. Requests use
protocol version 1, `no-store` and omit cookies. Roles are receiver, controller,
and audience.

| Method and suffix | Client use |
| --- | --- |
| `POST /sessions`, `/pair`, `/audience/join` | Receiver enrollment, controller pairing and audience join; idempotency keys. |
| `POST /sessions/:sessionId/sync` | Role-specific presence and snapshot synchronization. |
| `PUT /sessions/:sessionId/state` | Presenter command/state update with idempotency key. |
| `GET /sessions/:sessionId/ideas`, `/sessions/:sessionId/ideas/:ideaId`, `/sessions/:sessionId/ideas/:ideaId/streetmix-thumbnail` | Paginated catalog, detail and PNG preview. |
| `POST /sessions/:sessionId/pairing` | Rotate presenter code with idempotency key. |
| `DELETE /sessions/:sessionId/participants/me`, `/sessions/:sessionId` | Leave participant or end session. |
| `WS /ws` | Optional state/presence transport; first auth frame carries participant credential, no credential in URL. HTTPS remains authoritative fallback. |

The [socket source][socket-source] and [transport runbook][transport-runbook]
describe opt-in socket flags and retry/fallback; they do not prove rollout. V2
contracts, pairing, views, and recovery are owned by [#85][85]–[#90][90].

## Providers, media, and data dependencies

The following sections group source evidence by integration boundary.

### Identity and abuse controls

Firebase Auth/App Check and Google reCAPTCHA Enterprise are client integrations;
claims and deployment enforcement need backend confirmation. [#47][47],
[#15][15].

### Maps and geolocation

[Google Maps JavaScript loader][google-maps-javascript-loader] loads maps and
places and uses autocomplete/geocoding; browser geolocation is separate.
[#41][41], [#43][43].

### Overpass geometry and labels

[Overpass location acquisition][overpass-location-acquisition] POSTs
coordinate-based queries to `overpass.openstreetmap.fr/api/interpreter` and
`overpass.private.coffee/api/interpreter` (development proxies `/__overpass` and
`/__overpass-kumi`) for nearby geometry, buildings, stops and areas.
[Neighborhood labels][neighborhood-labels] `POST` bounds queries to
`overpass-api.de/api/interpreter` and the private.coffee interpreter (or its
development proxy). These are public third-party services; availability,
privacy, attribution and limits require review. [#61][61], [#95][95], [#93][93].

### Uploads and thumbnails

Signed storage upload URLs, suggestion media URLs and Streetmix PNG relay are
separate media boundaries. Migration reviewers should verify that clients do not
forward application credentials to third-party URLs. [#16][16], [#72][72],
[#100][100].

### Embedded designs and speech

[Presentation Streetmix][presentation-streetmix] can embed an allowlisted
Streetmix URL and fall back to an image.
[Browser speech recognition][browser-speech-recognition] depends on the
browser's implementation; the frontend does not establish where audio is
processed. [#73][73], [#51][51].

### Boundary and representative datasets

Stored boundaries, representatives and recommendable actions arrive through the
HTTP contracts in this inventory; source datasets and backend provider
acquisition are not established by frontend call sites. [#61][61]–[#63][63].

### Browser-local data

[Browser storage][browser-storage] holds draft content and author profile
(including email), cached suggestions and preferences; photo drafts can include
data URLs. It is origin-bound and must not be assumed transferable to v2.
[#101][101], [#50][50].

### Offline caching and fonts

The [build configuration][build-configuration] defines runtime caching for
suggestion API responses, Google Maps and Google Fonts and excludes presentation
API traffic. [Index HTML][index-html] loads Google Fonts.

The inventory maps private-data caching review and *progressive web app (PWA)*
behavior to [#46][46]; it does not establish that the predecessor caching policy
is appropriate for v2.

## Runbook assumptions and outstanding evidence

The committed [staging API runbook][staging-api-runbook] describes documented
Firestore/SQL/storage separation, App Check, backend provider flags and
deployment checks. It explicitly distinguishes planning from provisioned
resources. When you review this evidence, you should treat the backend claims as
runbook statements, not verified live behavior from backend source. Confirm the
backend revision, endpoint enforcement, provider/dataset provenance, media
visibility and deployed frontend/backend pairing before migration; do not query
or mutate production as part of this inventory. [#100][100], [#103][103] and
[#104][104] own later migration and acceptance evidence.

[92]: https://github.com/DallasUrbanists/idea-map/issues/92
[ee0552e3348a286b69e2540aa332217cdecd28cb]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb
[base-url-selection]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/stagingOrigin.js
[api-headers]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/api.js
[firebase-client]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/firebase.js
[15]: https://github.com/DallasUrbanists/idea-map/issues/15
[47]: https://github.com/DallasUrbanists/idea-map/issues/47
[44]: https://github.com/DallasUrbanists/idea-map/issues/44
[45]: https://github.com/DallasUrbanists/idea-map/issues/45
[62]: https://github.com/DallasUrbanists/idea-map/issues/62
[65]: https://github.com/DallasUrbanists/idea-map/issues/65
[61]: https://github.com/DallasUrbanists/idea-map/issues/61
[63]: https://github.com/DallasUrbanists/idea-map/issues/63
[16]: https://github.com/DallasUrbanists/idea-map/issues/16
[50]: https://github.com/DallasUrbanists/idea-map/issues/50
[48]: https://github.com/DallasUrbanists/idea-map/issues/48
[66]: https://github.com/DallasUrbanists/idea-map/issues/66
[57]: https://github.com/DallasUrbanists/idea-map/issues/57
[playground-link]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/components/RecommendedActions.vue
[client]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/streetmix.js
[workflow]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/useStreetmix.js
[70]: https://github.com/DallasUrbanists/idea-map/issues/70
[71]: https://github.com/DallasUrbanists/idea-map/issues/71
[72]: https://github.com/DallasUrbanists/idea-map/issues/72
[73]: https://github.com/DallasUrbanists/idea-map/issues/73
[presentation-client]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationApi.js
[socket-source]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationSocket.js
[transport-runbook]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/presentation-websocket.md
[85]: https://github.com/DallasUrbanists/idea-map/issues/85
[90]: https://github.com/DallasUrbanists/idea-map/issues/90
[google-maps-javascript-loader]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/googleMaps.js
[41]: https://github.com/DallasUrbanists/idea-map/issues/41
[43]: https://github.com/DallasUrbanists/idea-map/issues/43
[overpass-location-acquisition]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/liveLocationData.js
[neighborhood-labels]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/neighborhoodLabels.js
[95]: https://github.com/DallasUrbanists/idea-map/issues/95
[93]: https://github.com/DallasUrbanists/idea-map/issues/93
[100]: https://github.com/DallasUrbanists/idea-map/issues/100
[presentation-streetmix]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/components/PresentationStreetmix.vue
[browser-speech-recognition]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/speechRecognition.js
[51]: https://github.com/DallasUrbanists/idea-map/issues/51
[browser-storage]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/storage.js
[101]: https://github.com/DallasUrbanists/idea-map/issues/101
[build-configuration]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/vite.config.js
[index-html]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/index.html
[46]: https://github.com/DallasUrbanists/idea-map/issues/46
[staging-api-runbook]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/deployment/cloud-api-staging-runbook.md
[103]: https://github.com/DallasUrbanists/idea-map/issues/103
[104]: https://github.com/DallasUrbanists/idea-map/issues/104
