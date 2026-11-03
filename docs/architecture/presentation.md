# Presentation contracts

You can use these contracts to implement TV playback, presenter controls, and
audience viewing with consistent authorization and recovery. The
[historical inventory](../v1-migration/presentation-inventory.md) supplies source
evidence; this guide defines the intended application boundary. The
[API policy](../policies/api-policy.md) governs validation, errors, authorization,
and durable idempotency.

The following contents links navigate within this guide:

- [Routes and responsibilities](#routes-and-responsibilities)
- [Pairing and lifecycle](#pairing-and-lifecycle)
- [State and content](#state-and-content)
- [Commands and conflicts](#commands-and-conflicts)
- [Delivery and recovery](#delivery-and-recovery)
- [Validation and implementation boundaries](#validation-and-implementation-boundaries)

## Routes and responsibilities

The application preserves these entry points and role boundaries:

| Route | Responsibility | Authority |
| --- | --- | --- |
| `/tv` | Enroll a receiver, show pairing information, render shared content, report rendering, and end the session | Receiver capability for its session; no general shared-state edits |
| `/remote` | Pair the controller and control playback | Controller capability for its session |
| `/remote/ideas` | Search and select presentation-eligible ideas | Controller-only catalog and selection |
| `/remote/styles` | Adjust map, rail, theme, and marker appearance | Controller-only shared appearance |
| `/remote/audience` | Show audience presence and control invitation display | Controller-only participant list and invitation controls |
| `/audience` | Join, follow, explore locally, return to presenter, and leave | Audience capability; no shared-state writes or participant list |

The server derives the role from the authenticated capability and checks session
membership on every operation. A role supplied by a browser is not authority.
Presentation credentials do not grant account, moderation, or private-idea access.
The receiver receives the invitation material necessary to display pairing/join
information; general audience snapshots exclude that material and receiver
diagnostics. Participant tokens never appear in another participant's projection.

## Pairing and lifecycle

Enrollment establishes separate receiver, controller, and audience capabilities.
Presenter pairing codes and audience viewing codes are separate admission inputs;
neither is a reusable participant credential. The server bounds attempts, expires
admission codes, and invalidates replaced presenter codes atomically. Rotation
does not silently revoke an already admitted participant; revocation is an
explicit lifecycle action. The server rejects expired or revoked capabilities
even if a browser retains them.

The session lifecycle is `waiting`, `active`, `ended`, or `expired`. The receiver
creates a waiting session; successful controller pairing activates it. An
authorized receiver or controller can end it. Audience departure affects only
that participant. Terminal states reject writes and stop client retries;
reconnection alone never creates a replacement session or enrollment.

Clients keep capabilities scoped to the participating tab and remove matching
credentials on terminal responses or successful departure. Admission inputs and
participant credentials must not appear in analytics, logs, shared caches, public
URLs, or projection documents. Invitation handling must consume and remove any
fragment before application telemetry or enrollment, and must not place tokens
in socket URLs. Responses containing session data use `Cache-Control: no-store`.

The lifecycle implementation in [#86](https://github.com/DallasUrbanists/idea-map/issues/86)
defines concrete admission-code lifetimes, session expiry, attempt limits, and
credential binding to account authentication. Contributors should specify and
test those limits before enabling enrollment; this contract does not infer
production values from predecessor client code.

## State and content

The server owns canonical presentation state and derives role-specific snapshots.
The following fields describe the logical contract, independently of transport
or the final endpoint serialization:

| Field or group | Meaning and constraints |
| --- | --- |
| `protocolVersion`, session identity | Explicit schema version and bound session; incompatible shared schemas stop I/O |
| `revision` | Server-owned nonnegative monotonic integer for committed shared-state changes |
| `ideaEpoch` | Server-owned generation advanced when selected content changes; separates content-local controls from later selections |
| `selectedIdeaId`, `contentVersion` | Nullable selected idea identity and the exact eligible content revision displayed |
| `mode` | `map`, `photo`, or `description`; no selection uses map with no album item and page zero |
| Camera | Finite latitude, longitude, and zoom within renderer-supported bounds |
| Appearance | Streets/satellite map style, rail visibility, light/dark theme, and bounded marker size/animation settings |
| Album | Stable item identity, photo frame, and caption visibility; Streetmix uses canonical framing and no photo caption |
| Description | Nonnegative page index valid for the selected content |
| Audience display | Separate Boolean flags for QR and viewing-code visibility, initially false |
| Receiver feedback | Applied revision, viewport, and loading/ready/error result; feedback does not advance shared state |

The server validates selected content and album membership, not just field types.
Only presentation-eligible approved content is exposed. Removal or loss of
eligibility invalidates projections and display access under the
[API removal policy](../policies/api-policy.md#submission-consent-and-removal).
An accepted command is not proof that a receiver has rendered its revision.

Audience navigation is local state: tab, camera, album selection, framing, and
description position do not mutate the shared session. Following applies while
connected, on the shared tab, and without detachment for that view. Return to
presenter restores shared values and clears detachment. A new idea epoch resets
content-local positions and detachment while preserving the local tab choice.

The receiver preserves readable captions, descriptions, map/rail views, photos,
Streetmix content, and independently controlled join information. Display states
remain accessible during resizing and reconnects; connection status is visible
without relying only on color. Wake Lock is optional and cannot be a correctness
requirement for synchronization or background execution.

## Commands and conflicts

Shared-state commands use authenticated HTTPS, not direct projection writes.
A logical command contains the session binding, `protocolVersion`, `baseRevision`,
validated writable state, and a bounded idempotency key. Clients cannot choose
the resulting revision or idea epoch. The server checks capability, session
liveness, content eligibility, and revision before committing a change.

The server stores the request fingerprint and receipt atomically with canonical
state in PostgreSQL. Concurrent retries of the same principal/operation/key and
body return one result; reuse with a different body returns `409`. An uncertain
network outcome retains the exact body and key. A pending duplicate does not
execute a second change. Receipt retention and expired-key recovery are part of
the concrete endpoint contract and must be specified before commands are enabled.

The server rechecks authorization before returning a stored receipt, then resolves
an existing matching receipt before treating its original base revision as stale.
This ordering preserves retry recovery without granting a revoked participant
access to an earlier result.

A stale base revision returns `409` and an authorized current snapshot. The
client validates that snapshot, rebases still-relevant intent, and sends a new
key for the changed request. If the idea epoch changed, old camera, album, frame,
and description-page intent is discarded. Automatic retry must not overwrite a
later selection with stale content-local controls.

The endpoint implementation follows the API policy's `400`, `401`, `403`, `404`,
`409`, and generic server-error semantics, and honors explicit retry timing for
throttled requests. Contributors should document exact endpoint paths, schemas,
payload bounds, catalog page limits/cursor validity, receipt retention, and
terminal error codes with the implementation. Historical API paths and numeric
idea identifiers are not compatibility requirements for this logical contract.

## Delivery and recovery

PostgreSQL remains the canonical state store under the
[architecture overview](architecture-overview.md). Committed changes and durable
projection intents are atomic; delivery retries cannot regress a projection to
an older revision. [#90](https://github.com/DallasUrbanists/idea-map/issues/90)
uses Firestore projection delivery where compatible with these role, ordering,
and recovery guarantees, with authenticated HTTPS synchronization as fallback.
Direct client writes to presentation projections are forbidden. The delivery
design does not assume sticky server instances.

Clients validate session identity, protocol, role projection, revision, and
selected content together before applying a snapshot. An older revision cannot
replace displayed state. Role metadata or presence can change without a shared
state edit, so delivery ordering and shared-state revisions are distinct. A
transport sequence is scoped to its connection and cannot order sessions or
replace canonical revisions.

Clients reconcile a missed update from a full authorized snapshot. A transport
takes over only after validating a snapshot at least as recent as displayed
state. During interruption, clients retain the last display with a disconnected
indicator, resume HTTPS synchronization, and reconnect the same participant.
Explicit terminal or content-removal responses clear the relevant display and
stop retries; an arbitrary connection close is not proof of revocation.

Any optional WebSocket adapter is explicitly enabled and carries snapshots and
presence only. Transport incompatibility falls back to HTTPS; shared-schema
incompatibility stops session I/O with a visible compatibility error. Enrollment,
commands, leaving, and ending remain authenticated HTTPS operations regardless
of the notification transport. Browser suspension and visibility restoration
require resynchronization, not an assumption of continuous timers.

## Validation and implementation boundaries

Contributors should use synthetic sessions and isolated browser contexts to
verify the following contracts at their implementation boundaries:

| Case | Required observation | Owning issue |
| --- | --- | --- |
| Pair, rotate, expire, revoke, leave, and end | Roles remain separate; old admission codes fail; no credential enters logs, URLs, caches, or another role's projection | #86 |
| Duplicate and concurrent command | One committed revision/result; conflicting key/body fails | #87 |
| Lost command response | Same receipt/body recovers the result without repeated side effects | #87 |
| Revision conflict and changed idea epoch | Valid current state is applied; unrelated intent can rebase; stale content controls are discarded | #87 |
| TV rendering and resize | Captions, photos, maps/rail, descriptions, Streetmix, and join information remain readable; applied revision is reported separately | #88 |
| Audience exploration and return | Local navigation never changes TV state; return restores following; new selection resets content-local positions | #89 |
| Duplicate, stale, missed, or malformed snapshot | No regression or partial application; full authorized resync recovers gaps | #90 |
| Transport disabled, disconnected, or incompatible | HTTPS fallback works; enrollment is not repeated; shared-schema mismatch stops I/O | #90 |
| Revocation or removal during reconnect | Stale transport data cannot restore access to removed content or a terminal session | #86, #90 |

The inventory/contract review for
[#85](https://github.com/DallasUrbanists/idea-map/issues/85) checks each route,
role, command invariant, and opt-in transport statement against the pinned source
links. Runtime acceptance belongs to #86–#90 and does not follow from a document
review. Contributors should record actual checks and limitations in each PR;
real provider/staging validation requires an authorized isolated environment.
These contracts do not authorize deployment, production cutover, live permission
changes, or copying predecessor implementation or secrets.
