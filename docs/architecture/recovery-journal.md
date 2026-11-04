# Recovery decision journal

Recovery operators need an independent record of removals and legal-hold
decisions made after a database backup. This design uses the foundation's private
backup bucket when it is provisioned and keeps PostgreSQL as the application's
authority. The journal and pending-removal components are not wired into live
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
a later legal hold. The journal preserves evidence of those decisions outside
PostgreSQL so recovery can fail closed. A foundation definition is not proof
that a backup bucket exists in a particular environment. The journal does not
replace database backups, authorize a removal or hold, invalidate public caches,
or by itself preserve
all held material. Sharing the existing bucket also means it is not independent
of a loss or compromise of that bucket.

Separate development and production environments use separate bucket prefixes
under `idea-map-v2/ENVIRONMENT/recovery-journal/`. No new database, bucket,
provider, or independent Terraform state is assumed. The backup writer must not
be able to create, update, or delete journal records; the journal writer must
not be able to change backup archives or completion records. Review inherited
grants and deny policies as well as the explicitly scoped grants.

The server package contains an encoder and decoder for version-one intent and
commit confirmation records and version-two hold-placement confirmations. It
also contains a create-only transport for private JSON, a reader for a
specifically identified object generation, an unwired live-reference inventory,
and an unverified recovery summary. The
encoder checks required fields and sizes but cannot verify authority, legal
meaning, or whether a reason or reference is non-sensitive; its caller must
establish those facts. The decoder rejects unknown versions, extra fields,
duplicate keys, noncanonical bytes, and a different environment. Preserve the
version-one encoding when extending the format; a failed decode keeps recovery
isolated. The transport validates the canonical record before writing, bounds
record size and write time, uses an opaque caller-supplied record ID and a
create-only precondition, and treats provider errors and timeouts as uncertain.
The summary conservatively identifies ideas in removal and hold-placement
intents, flags unconfirmed operations and all hold placements and releases for
authorized review, and reports confirmations without intents. A confirmed hold
ID alone does not preserve its authority or held material; the summary exposes
associated hold IDs only as unverified evidence. It never establishes inventory
coverage, removes a hold, changes a database, or
authorizes public access. Its output contains private identifiers and must not
be written to public logs. These components do not guard mutation paths, capture
held material, or reconcile a restore. They are not connected to live removal
or hold operations and are not sufficient to enable them.

## Record and access

Use versioned, create-only records with a unique operation ID and an opaque
object name. An intent and its confirmation use distinct record IDs and contain
the same operation ID in their bodies. A retry reuses the original record ID and
bytes. A record identifies its environment, operation, affected idea,
decision type, and time. Hold records also preserve the authorized person,
scope, non-sensitive case reference and reason, and authorization or delegation
reference; release evidence includes any required legal review. These fields
follow the [Privacy Policy](../policies/privacy-policy.md#retention-and-deletion).
Do not put raw content, contact details, credentials, or reasons in object names,
custom metadata, or operational logs.

Protect record bodies with the existing bucket's private access and encryption.
Give a dedicated writer only the object creation needed for the journal prefix,
not update, deletion, or backup-prefix access. Recovery readers need explicitly
reviewed access to record contents. Cloud Storage object listing is authorized at
bucket scope, so prefix restrictions do not by themselves confine list access;
account for that exposure when assigning the reader identity.

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
transaction can commit, while the transaction holds the relevant idea lock. The
writer must use a create-only precondition and a bounded timeout. A confirmation
may be written only after a database commit is known to have succeeded. A lost
response, rollback, or failed confirmation can leave an intent without proof of
the outcome; recovery must treat it as uncertain rather than infer a commit.

The intent must exist before commit even when storage returns an ambiguous
response. A timeout is not proof that the object was not created, and a retry
must reuse the operation ID rather than create a second decision. A failed
create-only precondition does not prove the existing record matches: a
separately authorized journal reader must verify its exact contents before the
operation can rely on it. The create-only writer cannot perform that read. A
database commit response can also be lost after commit. Do not write a negative
confirmation based only on an exception. Reconciliation must account for both
cases and keep uncertain material private.

The generation-specific reader bounds the record size and read time, rejects
unknown encodings or unavailable checksums, and validates the record format and
environment. It requires a separately authorized reader and a known object ID
and generation. A checksum detects accidental corruption, not an unauthorized
replacement, and a successful read does not verify who wrote the record, discover
other records, or prove inventory coverage.

An unwired readback helper compares a known record's current generation, checksum,
and canonical bytes with the saved intent, then checks that the generation and
its metadata have not changed during the read. It can help an authorized reader
investigate an ambiguous create-only write, but does not authorize the decision,
prove future availability or journal coverage, or reopen access. Its metadata
deadline stops waiting for a response; it does not cancel the underlying storage
client request. Review reader permissions and request limits before integration.

The reference inventory lists only the journal prefix with version listing,
rejects noncurrent objects, unexpected names, ambiguous pagination and invalid
metadata, and returns opaque IDs with exact generations. It also lists the
prefix for soft-deleted objects and fails if any are present or that listing
fails. It requires the writer fence before listing: new objects can otherwise be
missed between pages. It does not read record bodies and always reports coverage
as unverified. Its size, page and time limits can cause a safe failure; its
request deadline does not cancel an in-flight storage request. Review the reader's
bucket-wide list permission before use. Permanently deleted records, missing
tails, older backups, and unauthorized writers need separate evidence.

The checkpoint needs a coordinated boundary, not merely a timestamp. Suspend
all covered mutations, drain in-flight transactions and journal writes, verify
the current decision state and writer restrictions, and record the checkpoint
before resuming mutations through the guarded paths. Keep an inventory of archives
that predate that boundary: a checkpoint cannot supply decisions missing from an
older archive unless a separately verified baseline includes them. Establishing
coverage also requires a way to detect a missing or deleted record; successful
listing alone does not prove that no record was lost or bypassed.

During a recovery, fence the original writers and wait for in-flight operations
to finish before taking the journal inventory. Verify its checkpoint, integrity,
and complete coverage through the fence. An object timestamp or a backup start
time alone cannot identify every concurrent committed transaction: replay the
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
at placement. The current version-two confirmation does not capture the committed
assignment ID or placement time. Preserve and verify the necessary authorization
and referenced records through a reviewed recovery design; do not synthesize an
assignment or substitute a new hold ID to make a restore pass. Keep the target
isolated when the original evidence or its relationships cannot be established.

On restore, an operator verifies coverage and reads the relevant complete
journal before public reads or side effects resume. Apply removals and hold
placements conservatively and idempotently; do not release a hold or republish
content solely because an intent lacks a confirmation. An unresolved intent,
missing record, coverage gap, or incompatible schema keeps affected material
private and requires authorized reconciliation. Record the uncertainty and
include reconciliation time in the recovery measurement.

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
is closed or a lock is waiting.
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

An unwired application step accepts the saved intent and uses a separately
authorized journal reader and database coordinator. It verifies the current
moderator before reading the journal, compares the exact canonical intent and
live object generation, and rechecks the identity before committing. A restricted
database function verifies the saved intent and actor, waits for the exclusive
read-drain lock, and calls the existing removal transaction. It stores the
verified generation and application time atomically with that mutation. A retry
with the same generation returns the saved time without repeating the removal;
a changed generation, stale revision, failed read, or uncertain transaction keeps
the gate closed for review. PostgreSQL cannot verify Cloud Storage itself: only
the separately trusted coordinator may receive execute permission for this
function, and effective inherited grants must be checked. The normal preparation
role must not be able to apply removals directly. This step does not write a
confirmation, establish journal coverage, resolve other pending decisions, or
open the gate. It is not wired to a live endpoint or granted to a runtime role.

An unwired confirmation step runs in a separate transaction after a known
application commit. It stores a stable confirmation timestamp and a deterministic
UUIDv8 record ID derived from the operation ID with a fixed SHA-256 namespace.
Intent IDs remain UUIDv4, so the two kinds cannot share an object name. Preserve
the namespace and derivation for retries and older records; an incompatible
change requires a reviewed format migration. The database independently checks
the derived ID and a unique index rejects collisions among pending confirmations.
Journal readers reject a UUIDv8 name that does not match its confirmation's
operation ID; older UUIDv4 confirmation names remain readable for review.
It records the application's top-level transaction ID and rejects confirmation
in that same transaction, including after a savepoint. An older applied row
without that transaction evidence requires authorized review. Transaction IDs
are scoped to a database cluster, so an ID reused on a replacement cluster can
also conservatively block preparation and require review. This check does not
establish journal coverage or make a restored database safe to expose.

After the confirmation transaction is known to have committed, the create-only
writer can write the same canonical confirmation bytes on each retry. A lost
response or a create-only conflict remains uncertain until a separately
authorized reader compares the current generation and exact bytes. Neither a
successful write nor a matching read reopens the gate or proves completeness.
An unwired coordinator can compare the current confirmation's exact bytes and
generation, then record that verification in a separate authorized transaction.
A database function checks the original moderator, closed gate, saved ID and
preparation time; only a trusted coordinator may attest to the storage read.
Retries preserve the first verified generation and time. Verification is not
journal coverage, and it does not resolve the other pending decisions, the
independent access fence, or reopen the gate.

Granting a web identity general gate updates would also let it reopen the gate;
verify narrowly scoped grants and inherited permissions before integrating the
transaction. Direct or older removal entry points must not be able to bypass the
pending-decision protocol.

The suggestion page renders an idea fetched from the idea API. Guarding only the
inner API response is insufficient: the outer HTML response can continue after
that fetch finishes. The gate must cover the outer delivery as well as API and
media responses. Account for nested requests, connection limits, client
disconnects, and timeouts when choosing the coordination mechanism. The synthetic
staging cache can continue serving an earlier response, so it is not suitable
evidence for the immediate removal boundary.

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
all public projections, and any direct media or cache access. The synthetic
staging cache has different behavior and is not evidence for live removals.

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
The retention and disposition work in
[#56](https://github.com/DallasUrbanists/idea-map/issues/56) owns application-data
lifecycle integration. Coordinate its guarded mutation paths and scoped evidence
with this recovery process; a journal record by itself is not that integration.

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
    stopped, and that reopening waits
    for every pending decision. Exercise the real pooler and the deployed runtime
    separately from local provider fakes.
3. Restore an older archive after later synthetic decisions, reconcile the
    journal, and prove that withdrawn content and held material remain private.
4. Verify coverage checkpoint handling, old-schema compatibility, retention of
    records and held material, and expiration of unrelated backup copies.
5. Measure both recovery objectives on replacement infrastructure, including
    access, evidence capture, reconciliation, and any manual review. Do not
    claim the 24-hour recovery target from a local or incomplete rehearsal.
