# V1 capability and route parity matrix

Baseline: committed `DallasUrbanists/improvement-map` staging commit
[`ee0552e3348a286b69e2540aa332217cdecd28cb`](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb),
read via Git objects only. Dirty local changes were excluded. This document is an
inventory and proposal for maintainer review, not a declaration that a feature is
currently deployed or approved for removal.

## Classification and evidence

- **Documented production** means the committed docs describe a production site or
  behavior, not that this exact commit was deployed. Live deployment/version and
  provider configuration remain unverified.
- **Opt-in** means committed behavior is gated by a configuration switch or an
  explicit user action; its availability in any environment is unverified.
- **Experimental** means committed source describes a test, preview, or advisory
  feature, rather than established product behavior.
- **Committed, deployment unknown** means code exists but the source does not prove
  the feature is enabled or deployed. Maintainers must review uncertain classifications
  and any redesign or retirement proposal.

The [README](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/README.md)
describes production hosting, while the [staging runbook](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/deployment/firebase-staging.md)
distinguishes staging setup, rollout and live acceptance. Neither proves that the
pinned commit is running. The [Firebase configuration](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/firebase.json)
is a committed staging target with SPA fallback, not deployment evidence.

## Routes

All routes below come from the pinned [router](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/router/index.js).
The classifications describe source/documentation, not verified production status.

| Route | Committed purpose and classification | V2 issue / proposed disposition |
| --- | --- | --- |
| `/`, `/browse` alias | Browse and shared map; documented production, exact deployment unknown | [#41](https://github.com/DallasUrbanists/idea-map/issues/41), [#44](https://github.com/DallasUrbanists/idea-map/issues/44): retain map/list and navigation, redesign permitted |
| `/submit` | Location, photos, description and review; documented production, exact deployment unknown | [#50](https://github.com/DallasUrbanists/idea-map/issues/50), [#51](https://github.com/DallasUrbanists/idea-map/issues/51): retain journey, redesign with private-first submission |
| `/suggestion/:id` | Idea detail permalink; documented production, exact deployment unknown | [#45](https://github.com/DallasUrbanists/idea-map/issues/45), [#102](https://github.com/DallasUrbanists/idea-map/issues/102): retain stable IDs and sharing; replace browser-only metadata with initial HTML metadata and crawler-compatible raster previews |
| `/bookmarks`, `/my-actions` | Locally saved ideas/actions; committed, deployment unknown | [#64](https://github.com/DallasUrbanists/idea-map/issues/64), [#101](https://github.com/DallasUrbanists/idea-map/issues/101): retain and plan origin-bound migration |
| `/test` | Diagram developer gallery and live generation; experimental | [#99](https://github.com/DallasUrbanists/idea-map/issues/99), [#95](https://github.com/DallasUrbanists/idea-map/issues/95): preserve developer capability, review production exposure |
| `/tv`, `/remote`, `/remote/ideas`, `/remote/styles`, `/remote/audience`, `/audience` | Presentation screens; committed, deployment unknown; WebSocket transport opt-in | [#85](https://github.com/DallasUrbanists/idea-map/issues/85)–[#90](https://github.com/DallasUrbanists/idea-map/issues/90): preserve roles and pairing; confirm rollout |
| `/:pathMatch(.*)*` | Unknown paths redirect to `/`; committed, deployment unknown | [#11](https://github.com/DallasUrbanists/idea-map/issues/11), [#102](https://github.com/DallasUrbanists/idea-map/issues/102): define unavailable/redirect behavior; do not assume identical fallback |

## Capability and service inventory

Service names below are committed files in the pinned [service tree](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services).
Classifications are conservative: absent explicit documentation, committed code does
not prove live use. Every group maps to a v2 issue; details and redesign decisions
remain subject to review.

| Capability and committed service files | Classification | V2 issue / redesign intent |
| --- | --- | --- |
| Map/search/location: `geo`, `googleMaps`, `mapWorkspace`, `sharedBrowseMap`, `stagingOrigin` | Documented production / environment-specific, version unknown | [#41](https://github.com/DallasUrbanists/idea-map/issues/41), [#43](https://github.com/DallasUrbanists/idea-map/issues/43), [#12](https://github.com/DallasUrbanists/idea-map/issues/12): retain shared workspace and search with provider failure states |
| Markers/density: `emojiMapMarker`, `markerSpiderfier`, `suggestionDensityOverlay`, `googleMapsRailOverlay`, `neighborhoodLabels` | Committed, deployment unknown | [#97](https://github.com/DallasUrbanists/idea-map/issues/97), [#43](https://github.com/DallasUrbanists/idea-map/issues/43): preserve density and overlay controls |
| Themes/settings: `theme`, `styleSettings`, `diagramSettings`, `railSettings` | Documented UI behavior, version unknown | [#34](https://github.com/DallasUrbanists/idea-map/issues/34), [#43](https://github.com/DallasUrbanists/idea-map/issues/43): retain light/dark/system and map preferences |
| Local saved data: `bookmarks`, `localActions`, `savedRepresentatives`, `storage` | Committed, deployment unknown | [#64](https://github.com/DallasUrbanists/idea-map/issues/64), [#101](https://github.com/DallasUrbanists/idea-map/issues/101): retain saved content; explicit export/bridge for origin-bound storage |
| Submission/media: `image`, `submissionPhoto`, `submissionThumbnail`, `submissionShareMetadata`, `speechRecognition`, `ideaDateFormat` | Documented submission/detail, version unknown; speech opt-in by user | [#50](https://github.com/DallasUrbanists/idea-map/issues/50), [#51](https://github.com/DallasUrbanists/idea-map/issues/51), [#45](https://github.com/DallasUrbanists/idea-map/issues/45): retain photos, captions, dictation and metadata |
| Submission diagram: in non-development builds, [submission](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/views/SubmitView.vue) automatically queries public Overpass providers using the selected location and, when successful, uploads a generated SVG as the first submission image; submission continues if the thumbnail is unavailable | Documented behavior, exact deployment unknown | [#68](https://github.com/DallasUrbanists/idea-map/issues/68): acquire geometry asynchronously, generate SVG and raster previews with provenance, and support private-before-approval behavior, fallback and retries |
| Enrichment: containing areas, elected representatives and recommended actions in idea details | Committed, provider configuration and deployment unknown | [#61](https://github.com/DallasUrbanists/idea-map/issues/61), [#62](https://github.com/DallasUrbanists/idea-map/issues/62), [#63](https://github.com/DallasUrbanists/idea-map/issues/63), [#65](https://github.com/DallasUrbanists/idea-map/issues/65): retain acquisition and display with provenance and failure states |
| Grammar, spelling and clarity assistance in the submission flow | Documented behavior, deployment/provider configuration unknown | [#66](https://github.com/DallasUrbanists/idea-map/issues/66), [#51](https://github.com/DallasUrbanists/idea-map/issues/51): preserve optional assistance without corrupting drafts |
| Provider/API and accounts: `api`, `apiBaseUrl`, `firebase` | Committed, deployment/configuration unknown | [#15](https://github.com/DallasUrbanists/idea-map/issues/15), [#49](https://github.com/DallasUrbanists/idea-map/issues/49), [#92](https://github.com/DallasUrbanists/idea-map/issues/92): inventory contracts and replace with authenticated, private-first boundaries |
| Diagram core: `diagramContext`, `dividedStreets`, `locationDiagram`, `locationDiagramMinimal`, `locationDiagramVersionTwo`, `roadVisualCleanup`, `streetLabels`, `liveLocationData` | Experimental developer gallery with opt-in live queries; also used automatically in non-development submissions as described above | [#95](https://github.com/DallasUrbanists/idea-map/issues/95), [#99](https://github.com/DallasUrbanists/idea-map/issues/99), [#68](https://github.com/DallasUrbanists/idea-map/issues/68): retain geometry/labels and safe preview; no navigation claims |
| Rail/stops: `railCatalog`, `railCorridorGrouping`, `railDisplayCorridors`, `railGeometry`, `railJunctionFixtures`, `railRendering`, `railServiceOverrides`, `railSvgLayers`, `sourceRailRendering`, `simpleTransitStops`, `transitStops` | Experimental renderer/gallery; overlay deployment unknown | [#96](https://github.com/DallasUrbanists/idea-map/issues/96), [#98](https://github.com/DallasUrbanists/idea-map/issues/98), [#94](https://github.com/DallasUrbanists/idea-map/issues/94): preserve catalog and topology, audit artwork |
| Streetmix: `streetmix`, `useStreetmix` | Committed, deployment/provider access unknown | [#70](https://github.com/DallasUrbanists/idea-map/issues/70), [#71](https://github.com/DallasUrbanists/idea-map/issues/71), [#72](https://github.com/DallasUrbanists/idea-map/issues/72), [#73](https://github.com/DallasUrbanists/idea-map/issues/73): retain generation/replacement and previews after provider review |
| Presentation: `presentationApi`, `presentationLinks`, `presentationQr`, `presentationSession`, `presentationSocket`, `presentationState` | Committed, rollout unknown; [WebSocket transport opt-in](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/presentation-websocket.md) with HTTP fallback | [#85](https://github.com/DallasUrbanists/idea-map/issues/85)–[#90](https://github.com/DallasUrbanists/idea-map/issues/90): preserve roles, pairing and recovery; confirm transports |
| Onboarding/releases: `announcements`, `releaseVersions`, `releases` | Committed, rollout unknown | [#46](https://github.com/DallasUrbanists/idea-map/issues/46): retain welcome, installation and release notes |
| PWA/offline caching: service-worker static asset precaching and runtime caching for Google Maps scripts, Google Fonts and API responses | Documented behavior, exact deployment unknown | [#46](https://github.com/DallasUrbanists/idea-map/issues/46): deliberately cache the app shell and visited public ideas; exclude authenticated/private feeds from shared and offline caches and explain stale data |

## Documentation and migration crosswalk

The committed [docs tree](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/docs)
contains deployment and staging validation (`deployment/`, `ci-evidence.md`), CI and E2E receipts (`e2e-completion-runbook.md`, `playwright-modular-suites-runbook.md`, `test-maintenance.md`), local development (`local-development-validation.md`),
Storybook (`storybook.md`, `storybook-validation.md`), usability audits/evidence (`usability-audit.md`, `usability-evidence/`, `usability-findings.json`), release notes (`releases.md`), design explorations (`colors-working-copy.html`) and presentation transport/handoffs/wireframes (`presentation-websocket.md`, `presentation/`).
These are evidence and operational context, not proof that every feature is live.
V2 ownership: developer setup [#21](https://github.com/DallasUrbanists/idea-map/issues/21),
testing [#18](https://github.com/DallasUrbanists/idea-map/issues/18), catalog
[#38](https://github.com/DallasUrbanists/idea-map/issues/38), hosting
[#12](https://github.com/DallasUrbanists/idea-map/issues/12), and presentation
[#85](https://github.com/DallasUrbanists/idea-map/issues/85). Imported ideas/media,
local drafts, attribution and stable links belong to [#100](https://github.com/DallasUrbanists/idea-map/issues/100),
[#101](https://github.com/DallasUrbanists/idea-map/issues/101),
[#93](https://github.com/DallasUrbanists/idea-map/issues/93) and
[#102](https://github.com/DallasUrbanists/idea-map/issues/102). Browser storage is
origin-bound; do not promise automatic recovery across origins.

## Wiki crosswalk

The [wiki matrix](https://github.com/DallasUrbanists/idea-map/wiki/V1-Capability-and-Migration-Matrix)
links to this inventory and retains the origin-bound storage and pilot/full-parity
caveats. The inventory and its classifications remain subject to maintainer review.

## Review and remaining evidence

- Confirm actual deployment revision and enabled flags before treating any committed
  feature as deployed; classify unknowns rather than inferring rollout.
- Confirm proposed redesigns, legacy link behavior and whether each experimental or
  opt-in capability is retained, changed or deferred. No feature is silently dropped.
- [#92](https://github.com/DallasUrbanists/idea-map/issues/92) owns deeper backend
  API and dataset inventory; [#103](https://github.com/DallasUrbanists/idea-map/issues/103)
  and [#104](https://github.com/DallasUrbanists/idea-map/issues/104) own pilot and
  full-parity evidence respectively.
