# Recovery decision journal

The recovery journal preserves removal and legal-hold decisions outside the
application database. Operators use numbered versions in an existing Secret
Manager project and separately protected artifacts in the private backup bucket.
PostgreSQL remains authoritative for current application state. Use the
[backup and recovery procedure](../contributor-guides/backup-recovery.md) with this
guide when restoring a replacement.

The following contents links navigate within this guide:

- [Purpose and boundaries](#purpose-and-boundaries)
- [Record and access](#record-and-access)
- [Write and reconcile](#write-and-reconcile)
    - [Establish a baseline and fence](#establish-a-baseline-and-fence)
    - [Journaled operations](#journaled-operations)
    - [Guard public delivery](#guard-public-delivery)
    - [Reconcile a replacement](#reconcile-a-replacement)
- [Retention and held material](#retention-and-held-material)
    - [Review held material](#review-held-material)
- [Required evidence](#required-evidence)

## Purpose and boundaries

An older archive can contain content that was later withdrawn or lack a later
legal hold. Recover the independent journal and held artifacts before exposing
an older snapshot. If a decision, authority, or held copy is uncertain, keep the
replacement fenced for authorized reconciliation.

Use a separately owned secret per environment and a pinned journal epoch.
Keep the secret and held artifacts within the reviewed provider and ownership
boundaries. Separation from PostgreSQL protects against losing the database,
while a shared project compromise or administrative error can still affect
both recovery stores.

The server supplies opt-in journaled moderator removal and provisional hold
placement endpoints. Before enabling them, review all authorized decision
paths, including direct SQL, earlier revisions, beta publication and owner
withdrawal. The replacement needs coverage of those paths through its
recovery fence. See the [beta publication](https://github.com/DallasUrbanists/idea-map/issues/246),
[removal](https://github.com/DallasUrbanists/idea-map/issues/247), and
[owner lifecycle](https://github.com/DallasUrbanists/idea-map/issues/56) work.

## Record and access

Each numbered version contains a canonical baseline, decision, or fence.
An intent uses a UUIDv4 operation ID as its record ID. A confirmation uses a
separate deterministic UUIDv8 record ID derived from the operation ID. Preserve
the canonical encoding and the derivation namespace for existing records and
retries. A retry can create another numbered version with identical bytes.
Conflicting bytes, missing versions, malformed records, and confirmations
ordered before their intent require reconciliation.

Record the environment, affected idea, decision type, actor and time.
Hold confirmations preserve the exact committed hold ID and, in the current
format, the authority assignment and microsecond placement time. Review the
assignment and the supporting delegation independently. Earlier records and
unmatched confirmations may lack the information needed to identify a hold or
reconstruct its authority. Keep those cases under review and avoid matching
different holds by idea and case alone.

Retain minimal decision metadata and opaque case references. Keep the actual
removal reason and case evidence in restricted records. Keep content,
credentials, hashes and private identifiers out of provider resource names,
metadata and operational logs. Follow the
[Privacy Policy](../policies/privacy-policy.md#retention-and-deletion).

Give append and exact-version readback to distinct scoped principals.
Review effective inherited permissions, administrator access, retention and
the ability to replace or delete the secret. The backup writer needs no journal
access. Verify the operator's separate recovery privileges before relying on
the secret or allowing mutation traffic.

Read the exact numbered version for each checksum-bound append. The transport
uses a bounded wait, and a timeout can occur after the provider accepted the
append. Use the same saved bytes for retries and reconcile uncertain outcomes.
The exact version API is strongly consistent after an append. Listing and
the latest alias can lag. [Secret Manager consistency](https://cloud.google.com/secret-manager/docs/reference/consistency)

The sequence reader scans versions one through 10,000 per epoch and bounds
the elapsed scan. An append can cross that application limit before the
client detects it. Review quota, access and rollover well before reaching the
limit, including duplicate writes and recovery fences. The exact-version
inspection helper can read a separately identified version outside the scan
range when reconciling an ambiguous append. It requires the explicit version ID.

An epoch can bind the preceding epoch and its selected fence in the next
baseline's SHA-256 checkpoint. Verify each supplied link and preserve all
earlier versions needed by retained backups or holds. The reader accepts up
to eight supplied epochs and 64 MiB of framed data in total. Independently
verify the first baseline, any earlier required epochs, the absence of forks,
and the identity and fencing of every writer. Review the actual provider
quotas and scan duration. [Secret Manager quotas](https://cloud.google.com/secret-manager/quotas)

## Write and reconcile

### Establish a baseline and fence

1. Keep public traffic and covered writers independently fenced. Include
   earlier revisions, scheduled jobs, queued work, operator tools and direct
   database connections.
2. Drain in-flight writes and check outstanding or ambiguous operations.
   Account for permission propagation and existing credentials before
   relying on the fence.
3. Verify current decision state, writer restrictions and the precise
   archive boundary. Record the approved baseline in the epoch and identify
   older archives that require separately verified decision evidence.
4. To inventory the journal for recovery, append a fence with a fresh opaque
   nonce using an authorized recovery identity after writers have drained.
   Read each explicit version from the approved baseline through that
   exact number and check the nonce and checkpoint.
5. Stop on a missing, disabled or unreadable required version, unexpected
   bytes, incompatible epoch, or an ambiguous fence append. Keep the
   replacement isolated while verifying the actual scope and ordering.

A timestamp alone cannot establish the boundary between the archive and all
concurrent commits. Replay the verified overlap conservatively. Treat
the scan as evidence of its numbered entries and verify coverage of the
writer set independently.

### Journaled operations

The private `NUXT_JOURNALED_REMOVAL_*` settings pin the environment, project
number, secret, epoch and checkpoint. Use separate PostgreSQL identities for
public reads, preparation and coordination, pointing to the same database.
Use distinct Secret Manager append and read service accounts scoped to the
reviewed secret. A separate operator calls `authorize_journaled_public_access`
after establishing the reviewed baseline and verifying the independent fences.

Give preparation and coordination their respective journaled functions.
Keep legacy mutation functions, general gate updates and baseline authorization
out of those roles. The unjournaled moderation and legal-hold mutation helpers
remain internal to the server package. Review database and provider grants on
every enabled writer, including earlier application revisions.

For an authorized operator client, send requests to the configured origin
using a verified session cookie, JSON, and the normal session mutation header.

| Request | Enabled by | JSON fields |
| --- | --- | --- |
| `POST /api/moderation/removal` | `NUXT_JOURNALED_REMOVAL_ENABLED` | `ideaId`, `approvedRevisionId`, `operationId`, `classification`, `reason` |
| `POST /api/moderation/legal-hold` | `NUXT_JOURNALED_REMOVAL_HOLD_PLACEMENT_ENABLED` | `ideaId`, `requestId`, `caseReference`, `reason` |

Use a UUIDv4 for the operation or request ID. Retain the same request and ID
for retries. A removal proceeds in this order.

1. Authenticate the active moderator and verify the expected revision.
   Commit the pending decision and close the gate in one transaction before
   any external write, pausing public idea and media access.
2. Persist the journal target. Append the saved intent and read back its
   exact version using the separate reader. Keep access closed if any outcome
   is uncertain.
3. Acquire the exclusive public-access lock and apply the removal once the
   protected readers have drained. Verify the committed application before
   preparing the stable confirmation in a separate transaction.
4. Append the confirmation, compare its exact bytes, and persist the readback.
   Reconcile ambiguous commits from the saved operation and numbered versions.
5. Resolve only this removal's closure. The transaction reopens routine
   access only when its approved baseline is still valid and all other
   closures and pending decisions have cleared.

The original moderator must remain active and able to authenticate to retry.
If the actor becomes unavailable, the expected revision is stale, or any
saved state conflicts, keep access closed and escalate for authorized
reconciliation. An independent recovery or operator closure invalidates
automatic reopening. Verify that closure separately if its commit is uncertain.

Hold placement requires a current Executive Director or written delegate
assignment and an opaque case reference. It first commits broad protection
under the idea lock. A failed journal read or append leaves that protection
in force. An authorized retry reuses the hold and verifies the exact intent
and confirmation positions. Scope review and disposition follow the separate
process below.

### Guard public delivery

The database gate starts closed. Public idea, suggestion and preview responses
require a live database lease that checks the gate, closure records and pending
decisions. The outer suggestion response shares its transaction with its
server-side fetch through server-only context. Keep the lease until delivery
finishes or stops, and abort protected delivery on a lost or stalled guard.

The read lease uses a shared transaction-scoped advisory lock and read committed
isolation. The removal application takes the exclusive lock. While a protected
response is active, the lease checks for gate closure or a waiting exclusive
lock every 250 ms, with a ten-second local bound on a stalled check. Query delay,
pool saturation and network failure affect drain time. The writer's lock wait
has a five-second timeout. Leave the pending decision and closed gate in place
after a timeout. Measure the full path under the reviewed transaction pooler
and workload. [Neon connection budget](neon.md#connection-budget)

The web guard uses `private, no-store` for protected responses. Older cached
copies, direct media access, and older serving paths require an independent
traffic fence and cache review. Verify all serving revisions and caches before
relying on the gate or releasing a rollback fence.
[Hosting cache and withdrawal behavior](hosting-cache.md#cache-and-withdrawal-behavior)

### Reconcile a replacement

Restore behind an independent network and application fence. A snapshot can
contain an open gate and no record of later decisions. Place and verify a fresh
recovery closure on the replacement before evaluating its contents.

Authenticate the archived state, journal baseline and writer fence. Then
read through the selected journal fence, using all required linked epochs.
With the exact recovery closure present, the restricted coordinator can
suppress known removals and mark restored ideas with known hold decisions for
retention protection in one transaction. It marks the idea withdrawn and
unpublishes its previews. Retain the fence and separately check any missing
ideas, authority records, hold scopes, selected captures and external projections.

Treat uncertain removal intents conservatively and retain protection when
hold placement, scope or release is unclear. Keep unrelated approved content
unchanged. Reconciliation helpers return counts and unresolved evidence for an
authorized operator. Only the independently reviewed access and writer
procedure can authorize reopening.

## Retention and held material

Retain decision records while any live, noncurrent or soft-deleted backup
could need them, subject to the privacy policy and active legal holds.
Review deletion with a separate identity. Track primary deletion from the
original authorized removal time, including database and media copies. Retries
reuse the original decision time. See the
[retention procedure](../contributor-guides/backup-recovery.md#inspect-retention).

Use broad provisional protection while the authorized reviewer determines
case-specific scope. Preserve all potentially relevant versions, files and
related records with restricted access. After an authorized scope review,
material outside the recorded scope can return to the applicable deletion
process only after checking other holds and preservation obligations.
Keep withdrawn content private throughout.

Preserve required material separately so an unrelated person's information
does not stay in a whole database archive beyond its applicable deadline.
If relevant material cannot be isolated, keep affected copies protected while
the authorized operator resolves the scope or competing obligations.

### Review held material

1. Verify the authority assignment, active case and idea. Use
   `listAuthorizedHeldSourceCandidates` in a private operator process with
   the held-source database role to list reference types, row identifiers
   and exact media generations.
2. Account for earlier backups, historical media generations and other
   systems outside the primary listing. Record the selected sources and
   candidate artifact IDs in the restricted case record.
3. Use `captureAuthorizedHeldInventory` with scoped database and storage
   identities. It copies selected complete PostgreSQL rows and exact media
   generations into the `held-material` prefix of the private backup
   bucket as create-only artifacts with temporary object holds.
4. Use `recordJournaledHoldScopeReview` with the same operation ID, hold and
   manifest generation. The review verifies each retained artifact and
   compares the selected bytes against the current source before first
   recording the decision.
5. Reconcile the candidate IDs after an interrupted capture and retry an
   interrupted review with the same operation and manifest. Preserve the
   broader scope until an authorized reviewer verifies completeness, all
   overlapping obligations, and the independent copies.

A version-two manifest binds selected related records as well as revisions
and media generations. Recovery reads the exact manifest and artifacts
referenced by the review and checks their sizes, checksums, digests, generations
and observed holds. A missing artifact, altered metadata or ambiguous
readback keeps the scope under review. Individual artifacts are limited to
16 MiB, so use separately reviewed handling for larger or unsupported sources.

Issue #56 owns primary-data selection, release and disposition. The current
bulk retention check preserves the idea's broad protection. Before approving
primary or archive disposition, recheck the applicable holds and artifacts
under the boundary that also excludes new holds. Scope review alone leaves
public visibility and the broad primary protection in place.
[Issue #56 coordination](https://github.com/DallasUrbanists/idea-map/issues/56#issuecomment-6667385319)

## Required evidence

Before relying on the journal in an environment, use authorized isolated
resources and synthetic data.

1. Verify effective identity boundaries, including inherited access,
   scoped reads and appends, and denial of unauthorized update, delete
   and bypass paths.
2. Exercise removals, holds, retry ordering, journal failure and interrupted
   commits. Verify an unrelated closure persists and that concurrent or
   stalled readers and disconnected clients are fenced.
3. Restore an older archive on replacement infrastructure after later
   synthetic decisions. Verify withdrawal of the idea and preview, retention
   protection, exact held artifacts and the unaffected control.
4. Review scope and archive expiry independently of the content restore.
   Recheck provider expiry, journal continuity and recoverability of each
   required held generation before releasing any protection.
5. Measure recovery from incident start through verified restoration,
   including replacement setup, access, reconciliation and validation.
   Use the observed backup history separately to measure data loss.
   [Recovery acceptance](https://github.com/DallasUrbanists/idea-map/issues/32) · [Sustained retention and data loss](https://github.com/DallasUrbanists/idea-map/issues/260)
