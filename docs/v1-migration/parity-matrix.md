# V1 capability and route parity matrix

You can use this matrix to trace the predecessor app's routes and capabilities
and find their recorded migration mappings. It preserves historical source
evidence rather than defining current application requirements. The
[migration overview](README.md) explains how to read these records.

Baseline: committed `DallasUrbanists/improvement-map` staging commit
[`ee0552e3348a286b69e2540aa332217cdecd28cb`][ee0552e3348a286b69e2540aa332217cdecd28cb],
read via Git objects only. Dirty local changes were excluded. This document is a
historical source inventory, not a declaration that a feature is currently
deployed or approved for removal.

The following contents links navigate within this guide:

- [Classification and evidence](#classification-and-evidence)
- [Routes](#routes)
- [Capability and service inventory](#capability-and-service-inventory)
    - [Map, search, and location](#map-search-and-location)
    - [Markers/density](#markersdensity)
    - [Themes and settings](#themes-and-settings)
    - [Local saved data](#local-saved-data)
    - [Submissions and media](#submissions-and-media)
    - [Submission diagram](#submission-diagram)
    - [Enrichment](#enrichment)
    - [Grammar, spelling, and clarity assistance in the submission flow](#grammar-spelling-and-clarity-assistance-in-the-submission-flow)
    - [Provider APIs and accounts](#provider-apis-and-accounts)
    - [Diagram core](#diagram-core)
    - [Rail and stops](#rail-and-stops)
    - [Streetmix](#streetmix)
    - [Presentation](#presentation)
    - [Onboarding and releases](#onboarding-and-releases)
    - [*progressive web app (PWA)*/offline caching](#progressive-web-app-pwaoffline-caching)
- [Documentation and migration crosswalk](#documentation-and-migration-crosswalk)
- [Wiki crosswalk](#wiki-crosswalk)
- [Review and remaining evidence](#review-and-remaining-evidence)

## Classification and evidence

- **Documented production** means the committed docs describe a production site
    or
  behavior, not that this exact commit was deployed. Live deployment/version and
  provider configuration remain unverified.
- **Opt-in** means committed behavior is gated by a configuration switch or an
  explicit user action; its availability in any environment is unverified.
- **Experimental** means committed source describes a test, preview, or advisory
  feature, rather than established product behavior.
- **Committed, deployment unknown** means code exists but the source does not
    prove
  the feature is enabled or deployed. Maintainers must review uncertain classifications
  and any redesign or retirement mapping.

The [README][readme] describes production hosting, while the
[staging runbook][staging-runbook] distinguishes staging setup, rollout and live
acceptance. Neither proves that the pinned commit is running. The
[Firebase configuration][firebase-configuration] is a committed staging target
with *single-page application (SPA)* fallback, not deployment evidence.

## Routes

The following routes come from the pinned [router][router]. The classifications
describe source/documentation, not verified production status.

| Route | Committed purpose and classification | V2 issue / migration disposition |
| --- | --- | --- |
| `/`, `/browse` alias | Browse and shared map; documented production, exact deployment unknown | [#41][41], [#44][44]: retain map/list and navigation, redesign permitted |
| `/submit` | Location, photos, description and review; documented production, exact deployment unknown | [#50][50], [#51][51]: retain journey, redesign with private-first submission |
| `/suggestion/:id` | Idea detail permalink; documented production, exact deployment unknown | [#45][45], [#102][102]: retain stable identifiers and sharing; replace browser-only metadata with initial HTML metadata and crawler-compatible raster previews |
| `/bookmarks`, `/my-actions` | Locally saved ideas/actions; committed, deployment unknown | [#64][64], [#101][101]: retain and plan origin-bound migration |
| `/test` | Diagram developer gallery and live generation; experimental | [#99][99], [#95][95]: preserve developer capability, review production exposure |
| `/tv`, `/remote`, `/remote/ideas`, `/remote/styles`, `/remote/audience`, `/audience` | Presentation screens; committed, deployment unknown; WebSocket transport opt-in | [#85][85]–[#90][90]: preserve roles and pairing; confirm rollout |
| `/:pathMatch(.*)*` | Unknown paths redirect to `/`; committed, deployment unknown | [#11][11], [#102][102]: define unavailable/redirect behavior; do not assume identical fallback |

## Capability and service inventory

The following service names identify committed files in the pinned
[service tree][service-tree]. Classifications are conservative: absent explicit
documentation, committed code does not prove live use. Every group maps to a v2
issue; details and redesign decisions remain subject to review.

### Map, search, and location

Source evidence: Map/search/location: `geo`, `googleMaps`, `mapWorkspace`,
`sharedBrowseMap`, `stagingOrigin`

Classification: Documented production / environment-specific, version unknown

Migration work: [#41][41], [#43][43], [#12][12]: retain shared workspace and
search with provider failure states

### Markers/density

Source evidence: Markers/density: `emojiMapMarker`, `markerSpiderfier`,
`suggestionDensityOverlay`, `googleMapsRailOverlay`, `neighborhoodLabels`

Classification: Committed, deployment unknown

Migration work: [#97][97], [#43][43]: preserve density and overlay controls

### Themes and settings

Source evidence: Themes/settings: `theme`, `styleSettings`, `diagramSettings`,
`railSettings`

Classification: Documented user interface behavior, version unknown

Migration work: [#34][34], [#43][43]: retain light/dark/system and map
preferences

### Local saved data

Source evidence: Local saved data: `bookmarks`, `localActions`,
`savedRepresentatives`, `storage`

Classification: Committed, deployment unknown

Migration work: [#64][64], [#101][101]: retain saved content; explicit
export/bridge for origin-bound storage

### Submissions and media

Source evidence: Submission/media: `image`, `submissionPhoto`,
`submissionThumbnail`, `submissionShareMetadata`, `speechRecognition`,
`ideaDateFormat`

Classification: Documented submission/detail, version unknown; speech opt-in by
user

Migration work: [#50][50], [#51][51], [#45][45]: retain photos, captions,
dictation and metadata

### Submission diagram

Source evidence: Submission diagram: in non-development builds,
[submission][submission] automatically queries public Overpass providers using
the selected location and, when successful, uploads a generated *Scalable Vector
Graphics (SVG)* as the first submission image; non-abort acquisition failures
allow submission to continue, but import, rendering and upload failures fail
submission

Classification: Documented behavior, exact deployment unknown

Migration work: [#68][68]: complete submission even when the thumbnail is
unavailable, catch thumbnail failures and queue asynchronous retries; acquire
geometry and generate SVG and raster previews with provenance and
private-before-approval behavior

### Enrichment

Source evidence: Enrichment: containing areas, elected representatives and
recommended actions in idea details

Classification: Committed, provider configuration and deployment unknown

Migration work: [#61][61], [#62][62], [#63][63], [#65][65]: retain acquisition
and display with provenance and failure states

### Grammar, spelling, and clarity assistance in the submission flow

Source evidence: Grammar, spelling and clarity assistance in the submission flow

Classification: Documented behavior, deployment/provider configuration unknown

Migration work: [#66][66], [#51][51]: preserve optional assistance without
corrupting drafts

### Provider APIs and accounts

Source evidence: Provider/API and accounts: `api`, `apiBaseUrl`, `firebase`

Classification: Committed, deployment/configuration unknown

Migration work: [#15][15], [#49][49], [#92][92]: inventory contracts and replace
with authenticated, private-first boundaries

### Diagram core

Source evidence: Diagram core: `diagramContext`, `dividedStreets`,
`locationDiagram`, `locationDiagramMinimal`, `locationDiagramVersionTwo`,
`roadVisualCleanup`, `streetLabels`, `liveLocationData`

Classification: Experimental developer gallery with opt-in live queries; also
used automatically in non-development submissions as described in the
submission-diagram row

Migration work: [#95][95], [#99][99], [#68][68]: retain geometry/labels and safe
preview; no navigation claims

### Rail and stops

Source evidence: Rail/stops: `railCatalog`, `railCorridorGrouping`,
`railDisplayCorridors`, `railGeometry`, `railJunctionFixtures`, `railRendering`,
`railServiceOverrides`, `railSvgLayers`, `sourceRailRendering`,
`simpleTransitStops`, `transitStops`

Classification: Experimental renderer/gallery; overlay deployment unknown

Migration work: [#96][96], [#98][98], [#94][94]: preserve catalog and topology,
audit artwork

### Streetmix

Source evidence: Streetmix: `streetmix`, `useStreetmix`

Classification: Committed, deployment/provider access unknown

Migration work: [#70][70], [#71][71], [#72][72], [#73][73]: retain
generation/replacement and previews after provider review

### Presentation

Source evidence: Presentation: `presentationApi`, `presentationLinks`,
`presentationQr`, `presentationSession`, `presentationSocket`,
`presentationState`

Classification: Committed, rollout unknown;
[WebSocket transport opt-in][websocket-transport-opt-in] with HTTP fallback

Migration work: [#85][85]–[#90][90]: preserve roles, pairing and recovery;
confirm transports

### Onboarding and releases

Source evidence: Onboarding/releases: `announcements`, `releaseVersions`,
`releases`

Classification: Committed, rollout unknown

Migration work: [#46][46]: retain welcome, installation and release notes

### *progressive web app (PWA)*/offline caching

Source evidence: *progressive web app (PWA)*/offline caching: service-worker
static asset precaching and runtime caching for Google Maps scripts, Google
Fonts and API responses

Classification: Documented behavior, exact deployment unknown

Migration work: [#46][46]: deliberately cache the app shell and visited public
ideas; exclude authenticated/private feeds from shared and offline caches and
explain stale data

## Documentation and migration crosswalk

The committed [docs tree][docs-tree] contains deployment and staging validation
(`deployment/`, `ci-evidence.md`), *continuous integration (CI)* and *end-to-end
(E2E)* receipts (`e2e-completion-runbook.md`,
`playwright-modular-suites-runbook.md`, `test-maintenance.md`), local
development (`local-development-validation.md`), Storybook (`storybook.md`,
`storybook-validation.md`), usability audits/evidence (`usability-audit.md`,
`usability-evidence/`, `usability-findings.json`), release notes
(`releases.md`), design explorations (`colors-working-copy.html`) and
presentation transport/handoffs/wireframes (`presentation-websocket.md`,
`presentation/`). These are evidence and operational context, not proof that
every feature is live. V2 ownership: developer setup [#21][21], testing
[#18][18], catalog [#38][38], hosting [#12][12], and presentation [#85][85].
Imported ideas/media, local drafts, attribution and stable links belong to
[#100][100], [#101][101], [#93][93] and [#102][102]. Browser storage is
origin-bound; migration reviewers should not promise automatic recovery across
origins.

## Wiki crosswalk

The [wiki matrix][wiki-matrix] links to this inventory and retains the
origin-bound storage and pilot/full-parity caveats. The inventory and its
classifications remain subject to maintainer review.

## Review and remaining evidence

When you review this inventory, you should resolve these gaps in the evidence:

- Confirm actual deployment revision and enabled flags before treating any
    committed
  feature as deployed; classify unknowns rather than inferring rollout.
- Confirm recorded redesigns, legacy link behavior and whether each experimental
    or
  opt-in capability is retained, changed or deferred. No feature is silently dropped.
- Use [the frontend API inventory](api-dependencies.md) and
  [#92][92] for backend and
  dataset evidence, and [#103][103]
  and [#104][104] for pilot and
  full-parity evidence, respectively.

[ee0552e3348a286b69e2540aa332217cdecd28cb]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb
[readme]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/README.md
[staging-runbook]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/deployment/firebase-staging.md
[firebase-configuration]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/firebase.json
[router]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/router/index.js
[41]: https://github.com/DallasUrbanists/idea-map/issues/41
[44]: https://github.com/DallasUrbanists/idea-map/issues/44
[50]: https://github.com/DallasUrbanists/idea-map/issues/50
[51]: https://github.com/DallasUrbanists/idea-map/issues/51
[45]: https://github.com/DallasUrbanists/idea-map/issues/45
[102]: https://github.com/DallasUrbanists/idea-map/issues/102
[64]: https://github.com/DallasUrbanists/idea-map/issues/64
[101]: https://github.com/DallasUrbanists/idea-map/issues/101
[99]: https://github.com/DallasUrbanists/idea-map/issues/99
[95]: https://github.com/DallasUrbanists/idea-map/issues/95
[85]: https://github.com/DallasUrbanists/idea-map/issues/85
[90]: https://github.com/DallasUrbanists/idea-map/issues/90
[11]: https://github.com/DallasUrbanists/idea-map/issues/11
[service-tree]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services
[43]: https://github.com/DallasUrbanists/idea-map/issues/43
[12]: https://github.com/DallasUrbanists/idea-map/issues/12
[97]: https://github.com/DallasUrbanists/idea-map/issues/97
[34]: https://github.com/DallasUrbanists/idea-map/issues/34
[submission]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/views/SubmitView.vue
[68]: https://github.com/DallasUrbanists/idea-map/issues/68
[61]: https://github.com/DallasUrbanists/idea-map/issues/61
[62]: https://github.com/DallasUrbanists/idea-map/issues/62
[63]: https://github.com/DallasUrbanists/idea-map/issues/63
[65]: https://github.com/DallasUrbanists/idea-map/issues/65
[66]: https://github.com/DallasUrbanists/idea-map/issues/66
[15]: https://github.com/DallasUrbanists/idea-map/issues/15
[49]: https://github.com/DallasUrbanists/idea-map/issues/49
[92]: https://github.com/DallasUrbanists/idea-map/issues/92
[96]: https://github.com/DallasUrbanists/idea-map/issues/96
[98]: https://github.com/DallasUrbanists/idea-map/issues/98
[94]: https://github.com/DallasUrbanists/idea-map/issues/94
[70]: https://github.com/DallasUrbanists/idea-map/issues/70
[71]: https://github.com/DallasUrbanists/idea-map/issues/71
[72]: https://github.com/DallasUrbanists/idea-map/issues/72
[73]: https://github.com/DallasUrbanists/idea-map/issues/73
[websocket-transport-opt-in]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/presentation-websocket.md
[46]: https://github.com/DallasUrbanists/idea-map/issues/46
[docs-tree]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/docs
[21]: https://github.com/DallasUrbanists/idea-map/issues/21
[18]: https://github.com/DallasUrbanists/idea-map/issues/18
[38]: https://github.com/DallasUrbanists/idea-map/issues/38
[100]: https://github.com/DallasUrbanists/idea-map/issues/100
[93]: https://github.com/DallasUrbanists/idea-map/issues/93
[wiki-matrix]: https://github.com/DallasUrbanists/idea-map/wiki/V1-Capability-and-Migration-Matrix
[103]: https://github.com/DallasUrbanists/idea-map/issues/103
[104]: https://github.com/DallasUrbanists/idea-map/issues/104
