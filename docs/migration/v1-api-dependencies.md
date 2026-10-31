# V1 frontend API and external dependency inventory

This is a source inventory for [#92](https://github.com/DallasUrbanists/idea-map/issues/92),
not a claim about a live deployment or an instruction to copy the old security
model. Baseline: committed `DallasUrbanists/improvement-map` staging revision
[`ee0552e3348a286b69e2540aa332217cdecd28cb`](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb).
Only committed frontend source and its documentation were inspected; the separate
backend, actual provider configuration, deployed commit and runtime behavior were
not verified. The [parity matrix](v1-parity-matrix.md) supplies the broader route
and capability crosswalk. Replacement issue links identify ownership, not shipped
v2 endpoints.

## Base URL and authentication

[Base URL selection](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/stagingOrigin.js)
requires an explicit staging origin and otherwise uses the configured API origin
or production default. [API headers](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/api.js)
conditionally attach a browser-configured API key, Firebase App Check token and
Firebase ID bearer token; their presence in a request is not proof of backend
authorization. The [Firebase client](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/firebase.js)
uses email/password and Google login, observes ID-token changes and checks `staff`,
`role` or `roles` claims for UI state. Backend enforcement remains unverified.
V2 authorization and DTO boundaries belong to [#15](https://github.com/DallasUrbanists/idea-map/issues/15)
and account/session behavior to [#47](https://github.com/DallasUrbanists/idea-map/issues/47).

## Frontend-used HTTP contracts

Paths below are relative to the configured API origin unless stated otherwise.
Methods, shapes and fallbacks are client-observed; server validation and exact
response schemas require separate backend evidence.

| Method and path | Client-observed contract / dependency | V2 owner |
| --- | --- | --- |
| `GET /api/public-improvements/suggestions` | List accepts array or `data`/`items`/`suggestions`; caches results and may fall back to local/seed data on failure. | [#44](https://github.com/DallasUrbanists/idea-map/issues/44), [#15](https://github.com/DallasUrbanists/idea-map/issues/15) |
| `GET /api/public-improvements/suggestions/:id`; `GET /api/suggestions/:id` | Detail accepts `data` or bare object; forced refresh uses the latter and accepts `submission`/`data`/bare object. Normal detail may fall back to cached list. | [#45](https://github.com/DallasUrbanists/idea-map/issues/45), [#15](https://github.com/DallasUrbanists/idea-map/issues/15) |
| `GET /api/public-improvements/suggestions/:id/representatives?limit=500` | Expects an array; positive integer ID. | [#62](https://github.com/DallasUrbanists/idea-map/issues/62), [#65](https://github.com/DallasUrbanists/idea-map/issues/65) |
| `GET /api/public-improvements/suggestions/:id/boundaries` | Expects `data` array. | [#61](https://github.com/DallasUrbanists/idea-map/issues/61), [#65](https://github.com/DallasUrbanists/idea-map/issues/65) |
| `GET /api/public-improvements/suggestions/:id/recommended-actions`; `POST /api/recommendables/match` | Actions expect `data` array; matching sends JSON and expects `data` array. Match uses JSON headers directly rather than `apiHeaders`. | [#63](https://github.com/DallasUrbanists/idea-map/issues/63), [#65](https://github.com/DallasUrbanists/idea-map/issues/65) |
| `POST /api/public-improvements/suggestions/upload-url`; `PUT` returned signed URL | Requests JSON `contentType` and `filename`, expects `data.uploadUrl`/`publicUrl`; binary is uploaded directly to the supplied storage URL. | [#16](https://github.com/DallasUrbanists/idea-map/issues/16), [#50](https://github.com/DallasUrbanists/idea-map/issues/50) |
| `POST /api/public-improvements/suggestions` | Sends submission JSON and normalizes `data` or bare result; client cache updated. | [#50](https://github.com/DallasUrbanists/idea-map/issues/50), [#48](https://github.com/DallasUrbanists/idea-map/issues/48) |
| `POST /api/assist/grammar`, `/api/assist/clarity`, `/api/assist/summarize` | Sends text JSON; summary includes type and length constraints; expects `data.text`. | [#66](https://github.com/DallasUrbanists/idea-map/issues/66), [#57](https://github.com/DallasUrbanists/idea-map/issues/57) |
| `GET /playground/recommendables?idea=:id` | Browser navigation from the recommended-actions UI to the legacy search playground; not a JSON fetch. | [#63](https://github.com/DallasUrbanists/idea-map/issues/63) |

Evidence: [API client](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/api.js)
and [playground link](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/components/RecommendedActions.vue).

## Streetmix workflow

The [client](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/streetmix.js)
and [workflow](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/useStreetmix.js)
use `/api/suggestions/:id/streetmix`: GET current state; POST start; POST
`/regenerate`; GET `/requests/:requestId`; POST `/requests/:requestId/selection`;
and GET `/thumbnail` for a bounded PNG relay. Mutations carry idempotency keys;
replacement may carry `If-Match`; the client preserves pending operation data for
retry. Its author/staff check is UI behavior, not verified server authorization.
It restricts navigable result URLs to the Streetmix origin. V2 generation,
authorization, previews and integration belong to [#70](https://github.com/DallasUrbanists/idea-map/issues/70),
[#71](https://github.com/DallasUrbanists/idea-map/issues/71),
[#72](https://github.com/DallasUrbanists/idea-map/issues/72) and
[#73](https://github.com/DallasUrbanists/idea-map/issues/73).

## Presentation HTTP and socket contracts

The [presentation client](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationApi.js)
uses `/api/public-improvements/presentation` as a prefix. Enrollment creates a
participant identity/token client-side and stores credentials in tab session storage;
subsequent requests send a participant bearer token and participant-ID header, not
the ordinary `apiHeaders`. Requests use protocol version 1, no-store and omit
cookies. Roles are receiver, controller and audience.

| Method and suffix | Client use |
| --- | --- |
| `POST /sessions`, `/pair`, `/audience/join` | Receiver enrollment, controller pairing and audience join; idempotency keys. |
| `POST /sessions/:sessionId/sync` | Role-specific presence and snapshot synchronization. |
| `PUT /sessions/:sessionId/state` | Presenter command/state update with idempotency key. |
| `GET /sessions/:sessionId/ideas`, `/sessions/:sessionId/ideas/:ideaId`, `/sessions/:sessionId/ideas/:ideaId/streetmix-thumbnail` | Paginated catalog, detail and PNG preview. |
| `POST /sessions/:sessionId/pairing` | Rotate presenter code with idempotency key. |
| `DELETE /sessions/:sessionId/participants/me`, `/sessions/:sessionId` | Leave participant or end session. |
| `WS /ws` | Optional state/presence transport; first auth frame carries participant credential, no credential in URL. HTTPS remains authoritative fallback. |

The [socket source](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationSocket.js)
and [transport runbook](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/presentation-websocket.md)
describe opt-in socket flags and retry/fallback; they do not prove rollout. V2
contracts, pairing, views and recovery are owned by [#85](https://github.com/DallasUrbanists/idea-map/issues/85)–[#90](https://github.com/DallasUrbanists/idea-map/issues/90).

## Providers, media and data dependencies

- Firebase Auth/App Check and Google reCAPTCHA Enterprise are client integrations;
  claims and deployment enforcement need backend confirmation. [#47](https://github.com/DallasUrbanists/idea-map/issues/47), [#15](https://github.com/DallasUrbanists/idea-map/issues/15).
- [Google Maps JS loader](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/googleMaps.js) loads maps and places and uses autocomplete/geocoding; browser geolocation is separate. [#41](https://github.com/DallasUrbanists/idea-map/issues/41), [#43](https://github.com/DallasUrbanists/idea-map/issues/43).
- [Overpass location acquisition](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/liveLocationData.js) POSTs coordinate-based queries to `overpass.openstreetmap.fr/api/interpreter` and `overpass.private.coffee/api/interpreter` (development proxies `/__overpass` and `/__overpass-kumi`) for nearby geometry, buildings, stops and areas. [Neighborhood labels](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/neighborhoodLabels.js) POST bounds queries to `overpass-api.de/api/interpreter` and the private.coffee interpreter (or its development proxy). These are public third-party services; availability, privacy, attribution and limits require review. [#61](https://github.com/DallasUrbanists/idea-map/issues/61), [#95](https://github.com/DallasUrbanists/idea-map/issues/95), [#93](https://github.com/DallasUrbanists/idea-map/issues/93).
- The [local rail catalog](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/railCatalog.js) builds geometry from bundled [rail GeoJSON files](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails) and applies service overrides. The [map](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/googleMaps.js) uses it for the rail overlay, and the [submission workflow](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/views/SubmitView.vue) supplies it to location diagrams. Overpass does not acquire rail geometry; the local catalog is a separate data dependency. Confirm dataset provenance and licensing for v2. [#96](https://github.com/DallasUrbanists/idea-map/issues/96) owns the catalog and geometry, [#97](https://github.com/DallasUrbanists/idea-map/issues/97) the map overlay, and [#93](https://github.com/DallasUrbanists/idea-map/issues/93) licensing review.
- Signed storage upload URLs, suggestion media URLs and Streetmix PNG relay are separate media boundaries; do not forward app credentials to third-party URLs. [#16](https://github.com/DallasUrbanists/idea-map/issues/16), [#72](https://github.com/DallasUrbanists/idea-map/issues/72), [#100](https://github.com/DallasUrbanists/idea-map/issues/100).
- [Presentation Streetmix](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/components/PresentationStreetmix.vue) can embed an allowlisted Streetmix URL and fall back to an image. [Browser speech recognition](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/speechRecognition.js) depends on the browser's implementation; the frontend does not establish where audio is processed. [#73](https://github.com/DallasUrbanists/idea-map/issues/73), [#51](https://github.com/DallasUrbanists/idea-map/issues/51).
- Stored boundaries, representatives and recommendable actions arrive through the API contracts above; source datasets and backend provider acquisition are not established by frontend call sites. [#61](https://github.com/DallasUrbanists/idea-map/issues/61)–[#63](https://github.com/DallasUrbanists/idea-map/issues/63).
- [Browser storage](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/storage.js) holds draft content and author profile (including email), cached suggestions and preferences; photo drafts can include data URLs. It is origin-bound and must not be assumed transferable to v2. [#101](https://github.com/DallasUrbanists/idea-map/issues/101), [#50](https://github.com/DallasUrbanists/idea-map/issues/50).
- The [build configuration](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/vite.config.js) defines runtime caching for suggestion API responses, Google Maps and Google Fonts and excludes presentation API traffic. [Index HTML](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/index.html) loads Google Fonts. V2 must review private-data caching rather than inherit this policy; [#46](https://github.com/DallasUrbanists/idea-map/issues/46) owns PWA behavior.

## Runbook assumptions and outstanding evidence

The committed [staging API runbook](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/deployment/cloud-api-staging-runbook.md)
describes proposed Firestore/SQL/storage separation, App Check, backend provider
flags and deployment checks. It explicitly distinguishes planning from provisioned
resources. Treat its backend claims as runbook statements, not source-verified live
behavior. Confirm the backend revision, endpoint enforcement, provider/dataset
provenance, media visibility and deployed frontend/backend pairing before migration;
do not query or mutate production as part of this inventory. [#100](https://github.com/DallasUrbanists/idea-map/issues/100),
[#103](https://github.com/DallasUrbanists/idea-map/issues/103) and
[#104](https://github.com/DallasUrbanists/idea-map/issues/104) own later migration
and acceptance evidence.
