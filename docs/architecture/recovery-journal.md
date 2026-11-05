# Recovery decision journal

Recovery operators need an independent record of removals and legal-hold
decisions made after a database backup. This design uses numbered versions in
the existing Secret Manager service and keeps PostgreSQL as the application's
authority. Selected held artifacts would use the existing private backup bucket.
The journal and pending-removal components are not wired into live
decision mutations. The public request guard remains incomplete. A restored
service must remain isolated until its decisions can be reconciled and the
[recovery procedure](../contributor-guides/backup-recovery.md) is satisfied.

The following contents links navigate within this guide:

- [Purpose and boundaries](#purpose-and-boundaries)
- [Record and access](#record-and-access)
- [Write and reconcile](#write-and-reconcile)
- [Retention and held material](#retention-and-held-material)
- [Required evidence](#required-evidence)

## Purpose and boundaries

An older database archive can contain content that was later withdrawn, or lack
a later legal hold. The intended journal preserves evidence of those decisions outside
PostgreSQL so recovery can fail closed. Secret Manager and the existing backup
bucket are separately operated services; that separation does not prove
independence from a shared project compromise or administrative error. The
journal does not replace database backups, authorize a removal or hold,
invalidate public caches, or preserve all held material.

The proposed single decision store uses a separately owned secret per environment
and a pinned epoch. No new provider, database, or independent Terraform state is
assumed. No secret or permissions have been provisioned for this design. Review
inherited access, secret replacement and deletion, and writer separation before
relying on it. Held artifacts remain separately scoped in the backup bucket.

The server package contains an encoder and decoder for version-one intent and
commit confirmation records and version-two and version-three hold-placement
confirmations, a numbered sequence transport, and an unverified recovery summary.
The encoder checks required fields and sizes but cannot verify authority, legal
meaning, or whether a reason or reference is non-sensitive; its caller must
establish those facts. The decoder rejects unknown versions, extra fields,
duplicate keys, noncanonical bytes, and a different environment. Preserve the
version-one encoding when extending the format; a failed decode keeps recovery
isolated. Each numbered append or read has a bounded deadline; an uncertain
append may still create a version.

The summary conservatively identifies ideas in removal and hold-placement
intents, flags unconfirmed operations and all hold placements and releases for
authorized review, and reports the operation IDs of confirmations without intents
for review. An unmatched confirmation does not identify its affected idea. The
summary also identifies ideas requiring hold review when only a release intent
is present; that is not proof that a hold remains active. A confirmed hold ID alone does not preserve its
authority or held material; the summary exposes associated hold IDs only as
unverified evidence. It rejects conflicting idea IDs or case references for a
known hold ID across placement confirmations and release intents, regardless of
record order. Case comparison follows the placement function's removal of leading
and trailing ASCII spaces. Matching IDs and references do not verify the hold's
authority or the release. It never establishes inventory
coverage, removes a hold, changes a database, or
authorizes public access. Its output contains private identifiers and must not
be written to public logs. These components do not guard mutation paths, capture
held material, or reconcile a restore. They are not connected to live removal
or hold operations and are not sufficient to enable them.

## Record and access

Use canonical records with a unique operation ID and opaque record ID inside
each numbered version. An intent and its confirmation use distinct record IDs
and contain the same operation ID in their bodies. A retry reuses the original
record ID and bytes; a lost response can create another identical version. A
record identifies its environment, operation, affected idea, decision type and
time. Hold records also preserve the authorized person, scope, non-sensitive
case reference and reason, and authorization or delegation reference; release
evidence includes any required legal review. Follow the
[Privacy Policy](../policies/privacy-policy.md#retention-and-deletion).
Do not put raw content, contact details, credentials or reasons in resource
names, metadata or operational logs.

Use separate reviewed writer and reader identities. The writer must not disable,
destroy, or replace secret versions or change backup objects. Review effective
inherited permissions, administrator access, encryption, retention and recovery
access before integration.

## Write and reconcile

All authorized removal, withdrawal, hold placement, and hold release paths need
coverage, including database entry points, retries, and future writers. A
deployment must prevent an older or direct write path from bypassing the
journal. Establish a reviewed coverage checkpoint only after those paths are
guarded and the current decision state has been verified. A backup older than
the checkpoint cannot rely on the journal alone.

The unjournaled moderator-removal and legal-hold mutation helpers remain
available to their internal tests but are not exported from the server package
entry point. The locking hold check remains available for retention work.
This package boundary reduces accidental use; it does not revoke database
execution grants or prevent a direct SQL caller or an older deployed revision
from bypassing the journal. Review those paths and effective privileges before
establishing coverage.

The intended write protocol records an intent before the associated database
transaction can commit. The writer uses a bounded timeout and a separately
authorized reader compares the exact numbered version and canonical bytes. A
confirmation may be written only after a database commit is known to have
succeeded. A lost response, rollback or failed confirmation can leave an intent
without proof of the outcome; recovery must treat it as uncertain rather than
infer a commit. A timed-out append may still create a version, so a retry uses
the same saved bytes. Do not write a negative confirmation based on an exception.

An existing Secret Manager version is not a complete tail proof by itself:
access to a newly added version
by its exact number is strongly consistent, but
[version listing and the latest alias are eventually consistent](https://cloud.google.com/secret-manager/docs/reference/consistency).
Do not infer that a version does not exist from a recent list or latest read.

One sequence-fence option needs further validation before use: after independently
fencing and draining every decision writer, an authorized recovery identity could
append a sentinel version and use the returned exact version number as an upper
bound. [Secret version IDs](https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions)
start at one and advance with each addition; reading explicitly numbered versions
rather than listing or using the latest alias could expose gaps through that
sentinel. This depends on every covered decision being durably recorded before
commit, a verified baseline for older archives, no writers continuing past the
fence, and a protected secret that cannot be destroyed or recreated by a writer.
A disabled, destroyed, missing, or unreadable required version must keep recovery
isolated. An ambiguous sentinel write needs reconciliation, not an assumed upper
bound. The sequence would also need a reviewed rollover and expiration process for
decision metadata and held evidence, and measured quota, costs, and scan time.
A complete decision record fits within a Secret Manager version's documented
[payload limit](https://cloud.google.com/secret-manager/quotas), so a reviewed
design could use the numbered versions as the journal instead of maintaining
two copies of every decision. The [add-version request](https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets/addVersion)
has no caller-selected version ID or documented idempotency key. A lost response
and retry can therefore create duplicate versions. Reconciliation would need to
recognize exact retry bytes and reject conflicting decisions, without treating
an uncertain write as absent. The proposed sequence also needs verified
permissions, retention, writer fencing, and restore procedures before use.

An unwired sequence codec explores the single-store option: put the canonical
decision bytes directly in numbered Secret Manager versions. This uses the
existing Secret Manager service but needs a separately owned secret and distinct
permissions. A baseline entry contains a checkpoint digest, and a recovery fence
uses an opaque nonce. The codec checks supplied version numbers from one through
a selected fence, rejects missing or conflicting entries, and tolerates identical
retries. When an intent and its confirmation are both present, it rejects a
confirmation that precedes the first intent; an unmatched confirmation requires
review. It also decodes and summarizes the decisions without asserting coverage.
A matching sequence does not authenticate its source or baseline, prove all
writers used it, establish the fence, or allow access to reopen. An unwired
transport wrapper can append canonical entries with CRC32C and read explicit
numbered versions through a selected fence. It limits concurrency and elapsed
waiting, rejects missing or altered versions, and treats failed appends as
uncertain. A separate-reader helper compares the exact newly appended bytes but
does not prove effective identity separation. A timed-out request can still finish
if the injected transport ignores cancellation. Its returned sequence remains
unverified: callers must establish the actual secret's identity, authenticated
baseline, writer fence and coverage. An unwired Google transport targets only
the Secret Manager API and uses short-lived application credentials; local tests
inject fake credentials and responses. No live secret, effective permissions,
mutation path, or recovery path has been tested or connected to this transport.
The numbered sequence is the only decision transport in this branch. It is
unwired and has not been tested against a live secret. Held material remains
separately scoped in the existing backup bucket.

Secret Manager charges for enabled and disabled versions, not only requests.
For example, ten new versions per day retained for 90 days would reach about
900 active versions, or roughly $54 per month at the published $0.06 per active
version-month before the shared free tier. This excludes other operations,
locations, taxes, retries and services, and actual costs are prorated. Review
[current pricing](https://cloud.google.com/secret-manager/pricing), expected
volume, retention and safe rollover before provisioning. Do not destroy versions
needed by a retained backup or an active hold merely to reduce cost.

The checkpoint needs a coordinated boundary, not merely a timestamp. Suspend
all covered mutations, drain in-flight transactions and journal writes, verify
the current decision state and writer restrictions, and record the checkpoint
before resuming mutations through the guarded paths. Keep an inventory of archives
that predate that boundary: a checkpoint cannot supply decisions missing from an
older archive unless a separately verified baseline includes them. Establishing
coverage also requires a way to detect a missing or deleted record; successful
listing alone does not prove that no record was lost or bypassed.

During a recovery, fence the original writers and wait for in-flight operations
to finish before taking the journal inventory. Include old service revisions,
scheduled jobs, queued work, operator tools, and direct database writers in the
fence. Stop or isolate the relevant execution paths and verify the effective
access boundary with separately authorized checks. A successful IAM revocation
alone is not an immediate fence: permission changes need time to propagate and
requests already in flight may still complete. Account for propagation and
credential lifetimes, drain or resolve outstanding operations, and read through
a new fence after the boundary is established. If those steps cannot be verified,
keep the replacement isolated.

Verify the checkpoint, integrity, and complete coverage through the fence. An
version timestamp or a backup start time alone cannot identify every concurrent committed transaction: replay the
verified relevant overlap conservatively, and require authorized reconciliation
where order or outcome is unclear. If writers cannot be fenced or completeness
cannot be verified, keep the restored service isolated.

The current hold-placement function creates the hold ID inside PostgreSQL, but
the version-one journal confirmation does not record that ID. A later release
names a hold ID, and the same idea and case can have more than one hold over
time. A version-two hold-placement confirmation can identify the actual committed
hold ID; the caller must obtain it from the authorized transaction and establish
that the commit succeeded. A version-one placement confirmation and an uncertain
outcome require review. Before integrating the journal, verify the ID association
through the live mutation path. Do not match a release to a placement solely by
idea and case or apply it automatically.

The hold ID alone is not enough to recreate a database hold. The hold also refers
to an idea, a person, and a legal-authority assignment, and records its placement
time. An older archive may lack any of those rows or the assignment that was valid
at placement. A version-two confirmation preserves the committed assignment ID
and exact microsecond placement time, together with the assignment's actor,
authority type, grantor, grant time, and non-sensitive authorization reference.
Its caller must obtain these facts from the known committed hold and assignment.
The summary rejects an assignment actor that differs from the intent and
conflicting immutable facts for the same assignment ID across holds. An action's
authorization reference and its assignment's delegation reference can differ;
both require authorized review. These records do not independently authenticate
the person, the written delegation, or the stored facts. A version-one confirmation does not
contain these fields.
Preserve and verify the necessary authorization and referenced records through a
reviewed recovery design; do not synthesize an assignment or substitute a new
hold ID to make a restore pass. Keep the target
isolated when the original evidence or its relationships cannot be established.

On restore, an operator verifies coverage and reads the relevant complete
journal before public reads or side effects resume. Apply removals and hold
placements conservatively and idempotently; do not release a hold or republish
content solely because an intent lacks a confirmation. An unresolved intent,
missing record, coverage gap, or incompatible schema keeps affected material
private and requires authorized reconciliation. Record the uncertainty and
include reconciliation time in the recovery measurement.

An unwired suppression primitive can mark ideas from known removal intents
withdrawn and unpublish their previews on an independently isolated replacement.
It takes the exclusive public-read lock, requires the database gate to be closed,
locks the matching ideas, and reports counts for present and absent IDs. Repeating
it is safe, and an uncertain intent is suppressed as well. The function has no
`PUBLIC` execute grant; only a separately authorized recovery coordinator should
receive access after the independent network and writer fences are verified.
An unwired coordinator reads numbered entries through a selected fence before
invoking this primitive. It cannot authenticate the baseline or fence and does
not establish either fence. Its deadline bounds waiting for storage only; the
caller must also configure a database connection timeout. Database lock and statement timeouts bound the suppression
transaction. Neither helper opens the gate.
It does not authenticate the records, establish complete coverage, restore hold
evidence, reconcile moderation and trust records, update external projections or
caches, delete primary data, or open the gate. Keep the target isolated until
those outstanding tasks are resolved. A missing idea requires review; it can
represent an idea created after the restored archive rather than a verified
deletion.

The write protocol alone does not solve an unavailable journal: an already
authorized removal must still stop public access immediately, and a failed
write must not silently create a coverage gap. If an authorized removal cannot
be recorded because the journal is unavailable or the write outcome is
uncertain, block all public idea and media access until the removal and journal
are reconciled. The gate must fail closed when its own state cannot be verified.
Preserve the authorized pending decision and mark the journal coverage gap; do
not report the removal or recovery as complete merely because the gate closed.
Only an authorized recovery process can reopen public access after verifying
the removal, journal continuity, and all other pending decisions.

Closing the gate only after a failed journal call is insufficient: the process
can stop after an authorized decision or an ambiguous write and before it closes
the gate. Close public access and durably record the authorized pending decision
in the same protected transaction before attempting the journal write. Public
idea and media access briefly pauses for successful removals too. Keep it closed
if the write or commit is uncertain,
and reopen it only after the decision and journal are reconciled. Concurrent
removals must not reopen the gate while another decision remains pending.

The current gate stores only an open/closed value. It cannot distinguish a
routine removal pause from a recovery fence or another independent closure.
Consequently, even an exact readback of every confirmed removal is insufficient
to reopen it automatically. A reopening design needs durable, independently
addressable closure causes, or an equivalent independently verified fence.
Recording and clearing a removal's cause must serialize with new decisions and
must not clear a recovery or operator closure. A lost commit response must be
reconciled against durable state; it must not be treated as permission to open.
The initial closed state and restored databases require independent authorization
and coverage verification, not an empty list of pending removals.

This boundary must coordinate requests already in flight, including responses
that have read content but have not finished delivery. An unreadable or missing
gate state must deny access, and all public serving paths must honor it. A
timeout, process termination, or lost database commit response must not silently
reopen access or discard the pending decision. Do not enable live integration
until the complete ordering, access boundaries, and failure cases are implemented
and tested. If the pending transaction's outcome cannot be established, an
independent fail-closed fence must remain in place until authorized reconciliation.

The database schema creates one `public_access_gate` row in the closed state and
revokes table access from `PUBLIC`. The server package has a read-lease
primitive that holds a shared transaction-scoped advisory lock and refuses a
missing, closed, or unreadable gate. It reports a lost database connection through
an abort signal. The caller must hold the lease through delivery and stop the
response when the signal aborts. The in-progress web guard uses this primitive for
current idea, suggestion, and media routes. A reader periodically checks the gate
and for a waiting exclusive advisory lock, and aborts its response when the gate
is closed or a lock is waiting. The lease explicitly uses read committed isolation
so a later poll can observe a gate closure even if the role defaults to a stronger
isolation level.
The server package's public content entry points require a lease issued by the
read guard and refuse forged, released, or aborted leases. The public lease does
not expose its underlying database connection. Projection reads
check the lease again after the database query, and preview reads also propagate
its abort signal through storage I/O. Internal query helpers and direct database
access are not guarded by this API boundary; runtime grants and every public
serving path still require review.
Pending removals use a reserved one-client pool so occupied public readers cannot
prevent the writer from closing the gate. This adds to the documented connection budget.
The guard still lacks reviewed runtime grants, measured drain timing, and complete
coverage of future serving paths. It is not sufficient to enable live removals.
The check runs while each protected response is active and shares its database
client with that response's queries. A long-running query or delayed connection
can delay detection. Measure query volume and worst-case drain time under load;
the polling interval alone is not an immediate-removal guarantee.

An unwired pending-removal transaction verifies the moderator, closes the gate,
and stores the pending decision in the same database transaction through a
restricted database function. It does this without waiting for active readers,
so the committed closure survives termination while they drain. A later removal
transaction must acquire the exclusive advisory lock and drain those readers
before changing the idea. A reader can still deliver data between the closure
and its next check, so this ordering alone does not establish immediate removal.
The pending transaction keeps the moderator's free-text reason in the private
database and uses a non-sensitive reason in the journal intent. An older backup
and the intent alone cannot recover
the original free-text reason if the current database is lost; that metadata needs
separate authorized reconciliation. After a known commit, a successful call
returns the original record ID and canonical intent bytes for the journal writer.
A retry of the same operation returns the stored bytes, including the original
timestamp. An unwired coordinator can write those bytes to the journal and reports
an uncertain outcome without reopening the gate. It does not remove content or
confirm a database mutation. Keep the returned bytes private and do not infer
success from a failed or uncertain call.

An unwired database function can
pin the pending removal to one project number, secret ID and journal epoch while
the gate is closed. It rechecks the original moderator and saved intent; retries
must use the same target. A trigger prevents changing the pin or applying a
removal in the same transaction that created it. The coordinator must confirm the
pin transaction committed before any external append; a lost commit response
requires reconciliation. An unwired server helper checks the canonical saved
intent and current moderator, and returns success only after that transaction
commits. A failed identity recheck rolls the pin back. Existing applied rows
without a pin cannot be pinned automatically. The pin does not verify the
secret, effective access, baseline or coverage. An unwired coordinator appends
the saved intent only after the pin commits and compares the exact numbered
version with a separate reader. A lost append response remains uncertain; a
retry uses the same saved bytes and target. This does not prove coverage or
apply the removal. No runtime role receives this function, and the path is not
ready for live use.

An unwired sequence application step reads the exact numbered intent again,
then checks the saved bytes, original moderator, committed pin and matching
project, secret and epoch under the closed gate before applying the existing
removal. A retry must use the same version. A separately granted legacy
application function does not enforce this target: it must be retired or
restricted before any sequence path is enabled. Neither the exact read nor the
database check authenticates the journal baseline, writer fence or permissions.
After an uncertain application commit, an unwired status check can find the
committed version for the same actor, intent and pinned target, and a separate
reader must still compare its exact bytes. It refuses an uncommitted pin or
application, including through a savepoint. An unavailable read leaves the
outcome uncertain. A sequential retry checks that status before appending;
concurrent retries may still append identical versions and need reconciliation.
An unwired confirmation step rechecks the pinned target and commits the stable
confirmation before appending it. It compares the exact numbered entry through
a reader, then records verification only for the same target and a version
later than the intent. An uncertain append or read leaves the gate closed.
These steps do not establish that all decisions and held material are present.
If the verification commit response is lost, an unwired status check can recover
the committed confirmation version for the same decision and target. It must
read that exact version again; an inaccessible or different record is uncertain.
The database rejects a status read in the verification transaction, including
after a savepoint. Older verified rows without transaction evidence require
authorized reconciliation. A sequential retry reuses the verified version;
concurrent retries can still append identical versions.
An unwired coordinator joins preparation, journal readback, application and
confirmation using separately supplied database connections. A caller retains
the original operation and record IDs for retries. An uncertain write or read
keeps the decision pending; a revision that becomes stale after preparation
requires reconciliation. Even a confirmed result leaves the gate closed and
does not establish coverage or authorize reopening.
An isolated restore can also read each numbered entry through a selected fence
and suppress the removals found there. A missing version stops suppression;
successful reads do not authenticate the baseline, fence or writer cutoff and do
not authorize opening public access. The local rehearsal uses a synthetic
sequence and demonstrates only this fail-closed behavior.

The normal preparation role must not be able to apply removals directly.
Only a trusted coordinator can attest to an external sequence read. Check
inherited database and cloud permissions before any live integration.

An unwired confirmation step runs in a separate transaction after a known
application commit. It stores a stable confirmation timestamp and a deterministic
UUIDv8 record ID derived from the operation ID with a fixed SHA-256 namespace.
Intent IDs remain UUIDv4, so the two kinds cannot share a record ID. Preserve
the namespace and derivation for retries and older records; an incompatible
change requires a reviewed format migration. The database independently checks
the derived ID and a unique index rejects collisions among pending confirmations.
Journal writers and readers require a UUIDv4 name for an intent and the derived
UUIDv8 name for its confirmation. A different name fails closed.
It records the application's top-level transaction ID and rejects confirmation
in that same transaction, including after a savepoint. An older applied row
without that transaction evidence requires authorized review. Transaction IDs
are scoped to a database cluster, so an ID reused on a replacement cluster can
also conservatively block preparation and require review. This check does not
establish journal coverage or make a restored database safe to expose.

After the confirmation transaction commits, retrying the append uses the same
canonical bytes. A lost response or failed read remains uncertain until an
authorized reader verifies an exact numbered version. The coordinator records
the first verified version and time; it never reopens the gate.

The current preparation,
application, and confirmation steps require the original moderator to remain
active and able to authenticate. If that person loses access or is unavailable,
they cannot finish the pending operation through these steps. Keep the gate
closed and escalate for authorized recovery; a separately authorized operator
path and its audit evidence still need a design and test. Include that delay in
the recovery objective. Verification is not journal coverage, and it does not
resolve the other pending decisions, the independent access fence, or reopen the
gate.

Granting a web identity general gate updates would also let it reopen the gate;
verify narrowly scoped grants and inherited permissions before integrating the
transaction. Direct or older removal entry points must not be able to bypass the
pending-decision protocol.

The suggestion page renders an idea fetched from the idea API. Guarding only the
inner API response is insufficient: the outer HTML response can continue after
that fetch finishes. The gate must cover the outer delivery as well as API and
media responses. Account for nested requests, connection limits, client
disconnects, and timeouts when choosing the coordination mechanism. Guarded
staging responses now request no storage, but older revisions or previously
cached responses can still serve content. Clear or expire those copies and
verify the deployed route before relying on the immediate removal boundary.

Hosted web traffic uses Neon transaction pooling and a two-client public-read
pool. Do not assume a session-level advisory lock remains attached to a backend
across transactions. Holding a client for an outer render while the nested API
request needs another client can also exhaust that pool under concurrent load.
Verify the selected coordination mechanism against the actual pooler and the
complete render path, including a queued removal and concurrent page requests.
A disposable PostgreSQL probe showed that a later `FOR SHARE` reader could join
while an update was waiting for an earlier reader. A shared row lock alone does
not prevent new readers from delaying the gate; test admission and bounded drain
behavior explicitly. In the same kind of local probe, a waiting exclusive
transaction-scoped advisory lock prevented a later shared lock from entering.
That result does not validate Neon pooling, resource limits, deadlock handling,
or the application response lifecycle; all public readers and removal writers
would have to use the same reviewed lock convention.
A synthetic local-fetch probe against the built Nitro runtime did not carry a
custom server-side context object into the nested request. Do not assume an inner
request can reuse an outer request's guarded transaction. Test any alternative
context propagation and cleanup against the deployed runtime. Never trust a
client-supplied header as proof that a request holds a guard.
A synthetic probe of two concurrent built suggestion-page renders preserved
distinct Node `AsyncLocalStorage` values when the outer request explicitly wrapped
its internal fetch. It used a database fake and initialized the module URL before
importing the internal bundle, as the normal server entry point does.
That result does not show that a middleware guards the full rendered response or
that every internal fetch uses the same context. Verify actual database locks,
the hosted pooler, and concurrent and disconnected requests before relying on it.

The gate and pending state need a guarded transaction and must cover every
public read, projection, and media delivery path. A restored older database may
not contain the later gate or pending decision, so recovery must begin behind an
independent access fence. If journal coverage or the pending decisions cannot be
proved after a failure, keep the replacement isolated for authorized
reconciliation. Implement and test that fence and the emergency path before
enabling live removals or relying on the journal.
The existing [Hosting cache policy](hosting-cache.md#cache-and-withdrawal-behavior)
uses `private, no-store` for dynamic production responses, and media previews
recheck publication state after fetching the object. Those controls are useful
starting points, but a complete failure path must also cover in-flight reads,
all public projections, and any direct media or cache access. Past synthetic
staging cache tests are not evidence for live removals.

## Retention and held material

Retain decision records while any recoverable backup can require them, subject
to the privacy and legal-hold rules. Before deleting a journal record, verify
that older live, noncurrent, and soft-deleted backups can no longer restore the
affected decision and that no applicable hold requires the record. Review
deletion with a separate identity; the writer cannot delete records.

Pending database decisions also contain a private free-text reason and refer to
the idea and actor. An unresolved decision must not become an indefinite hold on
that information or prevent the applicable deletion deadline from being met.
Before live integration, establish timely reconciliation and a reviewed way to
minimize and dispose of pending data without reopening the gate prematurely.

A hold on a complete database archive can retain unrelated people's data past
their deletion deadlines. Preserve only the material and evidence covered by an
authorized hold, with restricted access and its own reviewed release and
deletion process. The record is not the held material. The exact evidence
capture, scope, and lifecycle remain unresolved and must be established before
live backups or holds depend on this design.

Capture must cover material added or changed after the latest archive and any
associated media, not just a database row or a reference to an expiring object.
For an authorized scope, a future capture must identify exact content revisions
and media generations, preserve the scoped material separately, and verify that
capture completed before treating it as recoverable. Coordinate that capture
with the idea and retention locks so deletion or replacement cannot silently race
it; a missing generation, interrupted capture, or ambiguous completion requires
an explicit hold on deletion and authorized follow-up. Do not place raw content
in decision records or extend a hold to unrelated material by default.
An unwired storage primitive can write one already-scoped private artifact to the
existing backup bucket under a caller-supplied UUIDv4, then read its exact generation
and check its size and SHA-256 digest. It requests a temporary object hold in the
create-only upload and requires the returned metadata to confirm it. A failed or
ambiguous response can still leave a held object behind; reconcile and dispose
of orphaned artifacts through the separately authorized retention process. The
readback does not check that a hold remains in effect, and the upload response
does not prove effective permissions or future protection.
Each artifact must contain between one byte and 16 MiB, so empty or larger
material cannot be captured by this primitive. The caller must generate a random,
opaque ID and keep IDs, references, hashes, and bytes private. The caller
must establish authority and scope, capture every required revision and media
generation under the appropriate locks, and protect the references separately.
An unwired manifest format can associate selected revision or media references
and exact artifact generations with one hold; a version-three confirmation can
reference the stored manifest. The caller must read that exact generation before
reconciliation checks the manifest's digest, environment, operation, idea and
hold IDs. An unwired verifier can also read each listed generation and check its
size and digest. It reads at most four artifacts concurrently, limits the
manifest and artifact bytes together to 128 MiB, and bounds waiting to two
minutes. Missing, altered, oversized, or unavailable artifacts fail
verification. A revision entry can represent only
part of a revision, and the manifest does not establish what the authorized
scope requires or guarantee future availability. The primitives do not
authenticate the scope, capture all evidence, implement complete retention, legal-hold
release or disposition, or establish complete recovery. Do not use them to
authorize deletion or enable a live hold workflow. Review permissions for the
separate `held-material` prefix before any live integration.
An unwired sequence check finds the recorded hold placements and verifies each
available version-three capture. It reports placements without captures and
other decisions requiring review; it does not authenticate the journal or hold
authority. It checks at most 100 placements and 512 MiB of manifests and selected
artifacts within two minutes, with the per-capture limits still applying.
The retention and disposition work in
[#56](https://github.com/DallasUrbanists/idea-map/issues/56) owns application-data
lifecycle integration. Coordinate its guarded mutation paths and scoped evidence
with this recovery process; a journal record by itself is not that integration.

For an authorized removal, the application-data process must track the original
authorization time and target primary deletion within 14 days. Its completion
evidence must cover the applicable database records and media generations, not
just suppression from public views or a queued deletion request. Track any
remaining copies and active holds for authorized follow-up, using only the scope
needed for the decision. A valid hold can require restricted retention beyond the
ordinary deadline; do not treat a pending hold review as proof that every copy
is held. Repeated requests or retries must not silently restart the original
deadline. Preserve the minimum evidence needed to reconcile older backups without
indefinitely retaining the content or private reasons being deleted. The #56
lifecycle must define and implement those records, timing, and disposition;
this journal does not currently verify primary deletion or backup expiry.

## Required evidence

Before relying on the journal, test with synthetic data and isolated resources:

1. Verify effective identity boundaries, including inherited access, prefix
    conditions, no update or delete, and denial of backup-writer journal access.
2. Exercise all removal and hold paths, retries, direct database bypass attempts,
    concurrent decisions, failed or ambiguous storage writes, rollbacks, lost
    commit responses, and failed confirmations. Stop the writer at each boundary
    between authorization, gate protection, journal write, database commit, and
    reconciliation; verify public reads and in-flight responses remain protected.
    Include concurrent outer page renders and direct API and media requests,
    a stalled or disconnected client, a queued gate closure, exhausted database
    connections, a lost database connection, and a terminated reader. Verify the
    shared lock is released only after the protected response finishes or is
    stopped, and that reopening waits for every pending decision. Test an
    unrelated recovery closure, a concurrent
    new removal, a lost reopen response, and a restored gate separately; none may
    clear another closure or infer journal coverage. Exercise the real pooler and
    the deployed runtime separately from local provider fakes.
3. Restore an older archive after later synthetic decisions, reconcile the
    journal, and prove that withdrawn content and held material remain private.
4. Verify coverage checkpoint handling, old-schema compatibility, retention of
    records and held material, and expiration of unrelated backup copies.
5. Measure both recovery objectives on replacement infrastructure, including
    access, evidence capture, reconciliation, and any manual review. Do not
    claim the 24-hour recovery target from a local or incomplete rehearsal.
