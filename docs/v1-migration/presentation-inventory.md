# Presentation capability inventory

You can use this inventory to trace the predecessor's TV, presenter, and audience
behavior before implementing the [presentation contracts](../architecture/presentation.md).
This record describes committed source, not verified deployment or backend
enforcement. The [migration overview](README.md) explains that distinction.

The baseline is `DallasUrbanists/improvement-map` commit
`ee0552e3348a286b69e2540aa332217cdecd28cb`, matching the
[parity matrix](parity-matrix.md). The investigation used read-only GitHub file
reads; it did not run the predecessor, join a live session, or copy implementation,
configuration secrets, participant credentials, or admission codes.

The following contents links navigate within this inventory:

- [Routes and roles](#routes-and-roles)
- [Enrollment and lifecycle](#enrollment-and-lifecycle)
- [State and commands](#state-and-commands)
- [Transport and recovery](#transport-and-recovery)
- [Evidence and limits](#evidence-and-limits)

## Routes and roles

The pinned [router][router] and presentation views expose these capabilities:

| Route | Role and observed capability | Equivalent work |
| --- | --- | --- |
| `/tv` | Receiver enrollment, presenter pairing display, shared playback, render feedback, and session end | #86, #88 |
| `/remote` | Controller pairing and shared map, photo, and description controls | #86, #87 |
| `/remote/ideas` | Controller idea catalog and selection | #87 |
| `/remote/styles` | Controller map style, rail visibility, theme, and marker appearance | #87 |
| `/remote/audience` | Controller audience link, audience list, and independent QR/code visibility controls | #87 |
| `/audience` | Audience enrollment, follow/independent viewing, return to presenter, and leave/terminal display | #89 |

The [audience view][audience] and [state helpers][state] distinguish local
navigation from shared state. Audience members can switch map/photo/description
tabs, pan a map, choose an album item, adjust a photo frame, or change description
pages without controlling the TV. Returning to the presenter restores shared
values and clears detachment flags. A new idea epoch resets local content
positions and detachment flags while retaining the selected local tab.

The state model supports descriptions, captions, image framing, map camera,
rail visibility, and Streetmix album content. Photos precede at most one final
Streetmix item; Streetmix uses its canonical frame and does not display a photo
caption. These source observations do not establish rights to redistribute
provider content; the [rights inventory](rights-inventory.md) remains applicable.

## Enrollment and lifecycle

The [API client][api] distinguishes `receiver`, `controller`, and `audience`
credentials. Receiver creation uses `POST /sessions`, controller pairing uses
`POST /pair`, and audience joining uses `POST /audience/join`, under the historical
`/api/public-improvements/presentation` prefix. Enrollment includes protocol
version, a generated participant identity/token, and an idempotency key.

Admission codes are five-digit strings, preserving leading zeroes. Presenter
and audience codes serve different roles. Receiver enrollment returns both;
controller enrollment returns the audience code. The receiver can request a
replacement presenter code through `POST /sessions/{sessionId}/pairing`.
The [link helper][links] puts admission codes in fragments; the
[session client][session] removes the fragment before enrollment.

The client stores active credentials and pending enrollment/write receipts in
tab-scoped `sessionStorage`. Authenticated HTTP calls use the participant bearer
token and `X-Presentation-Participant`, omit browser cookies, and disable caching.
These are historical wire details, not a requirement to reuse the old credential
format or endpoint prefix.

The session envelope recognizes `waiting`, `active`, `ended`, and `expired`.
The client supports leaving through `DELETE /sessions/{sessionId}/participants/me`
and ending through `DELETE /sessions/{sessionId}`. The session helper permits
receiver/controller end actions; audience departure leaves only that participant.
Terminal credential/session errors stop retries and clear only the matching
participant's stored credential. An ordinary connection loss does not prove
revocation and does not repeat enrollment.

## State and commands

The [state model][state] and [session client][session] define these boundaries:

| Contract | Source-observed behavior |
| --- | --- |
| Protocol | Shared DTO protocol version `1`; unsupported responses stop session I/O |
| Ordering | Nonnegative safe-integer `revision` and `ideaEpoch`; state and envelope revisions must match |
| Selection | Nullable idea ID, `map`/`photo`/`description` mode, album item, frame, caption visibility, and description page |
| Appearance | Camera, streets/satellite map style, rail visibility, light/dark theme, QR/code display flags, and icon settings |
| Write | `PUT /sessions/{sessionId}/state` carries `protocolVersion`, `baseRevision`, and writable state, with `Idempotency-Key` |
| Server fields | Writable state excludes `revision` and `ideaEpoch` |
| Uncertain delivery | Retry retains the same key and exact body, including across persisted pending mutations |
| Definite conflict | `REVISION_CONFLICT` supplies the current envelope; the client rebases still-relevant changes with a fresh receipt |
| Idea change during conflict | Old camera, album item, photo frame, and description-page changes are discarded |
| Content | Selected idea carries `contentVersion`, summary, details, pages, location, and album; content identity must match selection |
| Role projection | Participant list and audience code are controller-only in sync envelopes; audience envelopes exclude receiver diagnostics |

The receiver reports applied revision, viewport, and loading/ready/error state.
Audience presence reports its local view; controller socket presence is empty.
The controller can distinguish a committed update from receiver rendering.
The source validates full envelopes before applying them and ignores older state
revisions; socket sequence ordering is a separate transport concern.

## Transport and recovery

The pinned [transport guide][transport] and [socket client][socket] describe an
opt-in WebSocket path. The frontend requires the exact string `true` for
`VITE_PRESENTATION_WEBSOCKET_ENABLED`; the documented backend requires both
presentation and WebSocket enablement. These transport switches default off.
The separate frontend presentation feature switch defaults to the development
build setting when unset; it is not the WebSocket switch.

The socket URL carries no credentials, query, or fragment. Its first frame
authenticates the existing participant; the socket accepts authentication and
presence, never presentation commands. Enrollment, state writes, catalog/detail
requests, thumbnails, leaving, and ending remain HTTPS operations.

HTTP sync remains active until a validated full socket snapshot is at least as
new as applied state. Socket protocol version `1` uses an initial `ready` frame
with sequence `1`, followed by increasing snapshot sequences; duplicate/older
sequences do not refresh display or liveness. The documented heartbeat interval
is 15 seconds. Disconnects resume HTTP sync while retaining the display and
participant identity; visibility restoration replaces stale connections.

The predecessor's HTTP polling intervals are 500 ms for receivers, 1 second for
audience, and 2 seconds for controllers. They are inventory evidence, not
prescribed service load for the replacement. Socket incompatibility keeps HTTP
fallback, whereas shared DTO incompatibility stops session I/O. Wake Lock is
best-effort for TV/controller and is not requested for audience phones.

## Evidence and limits

The following evidence links identify the source reviewed for this inventory:

| Evidence | What it establishes |
| --- | --- |
| [Router][router], [TV view][tv], [audience view][audience] | Routes, display roles, controls, and local viewing |
| [API client][api], [session client][session], [link helper][links] | Requests, enrollment persistence, commands, conflict handling, and fragment cleanup |
| [State helpers][state], [socket client][socket] | State validation, role projections, local audience semantics, and transport protocol |
| [Transport guide][transport] | Explicit opt-in, fallback, and documented operational limits |
| [State tests][state-tests], [connection tests][connection-tests] | Existing synthetic test cases for bounds, audience behavior, socket takeover, reconnect, and disabled transport |

The tests were inspected, not executed. Their mock backend does not prove real
backend authorization, production enablement, expiry durations, admission-code
rate limits, or live deployment. Those facts remain unverified. The inventory
does not supply legacy credentials or authorize a cutover. The intended
contracts and validation cases live in the [architecture guide](../architecture/presentation.md).

[router]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/router/index.js
[tv]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/views/PresentationTVView.vue
[audience]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/views/PresentationAudienceView.vue
[api]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationApi.js
[session]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationSession.js
[links]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationLinks.js
[state]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationState.js
[socket]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/presentationSocket.js
[transport]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/docs/presentation-websocket.md
[state-tests]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/tests/presentationState.spec.js
[connection-tests]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/tests/presentationConnection.spec.js
