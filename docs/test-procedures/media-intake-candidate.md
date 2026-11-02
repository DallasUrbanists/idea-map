# Review a synthetic media-intake candidate

This document is a **proposal for review**, not an adopted upload contract or
permission to enable uploads. The existing submission and storage paths do not
provide a complete, verified inventory of the media belonging to a revision.
Moderators therefore cannot yet review every part of a submission, and the
scoring gate cannot treat an invented media inventory as evidence.

The following contents links navigate within this procedure:

- [Candidate limits](#candidate-limits)
- [Identity and recovery](#identity-and-recovery)
- [Synthetic evaluation](#synthetic-evaluation)
- [Decisions and provider evidence](#decisions-and-provider-evidence)

## Candidate limits

For discussion, use JPEG, PNG, and WebP images, at most ten per submission, and
at most 10 MiB (10,485,760 bytes) per image. Ten images is the existing
[submission requirement](https://github.com/DallasUrbanists/idea-map/issues/50);
JPEG, PNG, and WebP are the existing public-preview types. The 10 MiB limit is a
proposed product choice, not an existing policy. It permits up to 100 MiB of
source files before generated files or retries, so storage, bandwidth, and
moderator workload need review.

A server-authorized draft would receive access for only an opaque, create-only
pending object, with a server-enforced size bound. The existing signing helper
allows an authorization lifetime of at most 15 minutes. A resumable upload
session may have a different lifetime; expiry or revocation of the initial
signed request must not be assumed to end that session. Session lifetime,
revocation, and cleanup need provider evidence and a reviewed recovery procedure.
A session URL is a bearer credential and must not appear in logs, public data,
or another user's response.

## Identity and recovery

The author or guest must be authorized against the draft before upload access
is issued. The server must persist the allocation and bind a validated exact
object generation to the intended draft and revision. The final submission must
identify each required source asset and caption without trusting browser-declared
completion. A missing, changed, unsupported, or unverified asset must leave
assessment incomplete and keep it out of any automatic-publication range.

Retries and interrupted connections must preserve the intended draft and photo
without creating duplicate submissions or attaching another user's object.
The reviewer must see the exact submitted revision and its required media before
making an approval decision. Verification must inspect actual bytes and bounded
image decoding, not just a filename or claimed content type. Object cleanup must
coordinate with draft, revision, moderation, legal-hold, and deletion writers,
and delete only an exact eligible generation. A signed upload or an object name
alone is not ownership or content evidence.

## Synthetic evaluation

Use a disposable local database and storage fake first. Do not use production
content, buckets, identities, or credentials. A candidate implementation should
record reproducible outcomes for:

1. Zero, one, ten, and eleven images; exact-limit and over-limit files; each
   proposed type; mismatched bytes and declared types; invalid, truncated, and
   unbounded-decoding inputs.
2. Interrupted upload and resume, expired authorization, session expiry or
   revocation, duplicate finalization, lost responses, and changed or replaced
   object generations. Preserve the original draft and stable identities.
3. Cross-user object references, forged draft ownership, a registered-email
   sign-in gate, revoked authorization, stale revisions, and concurrent
   cleanup, legal holds, edits, and moderation reads.
4. Incomplete and failed media assessments, captions, generated assets, and
   images that cannot be reviewed. Confirm none becomes a complete passing
   assessment merely because a browser reports success.
5. Public and private access boundaries, approved-preview transitions, removal,
   backup retention, restore safety, and recovery without exposing bearer URLs.

Provider behavior requires separately authorized isolated staging tests with
synthetic files and test-only identities. Record the exact project, region,
object generations, session behavior, permissions, cleanup ownership, and
observed results; a fake cannot establish those provider properties. Follow the
[media staging procedure](../policies/media-staging-procedure.md) only after
separate authorization for its actual staging access and changes.

## Decisions and provider evidence

Before adopting this candidate, the project owner and relevant reviewers need to
agree on the formats and byte limits, animation and metadata handling, safe
pixel/decoder bounds, resumable protocol and supported clients, retention and
cleanup deadlines, and recovery and abuse limits. Review actual provider terms,
region, access, session lifetime, costs, and deletion/backup behavior for the
selected environment. Document decisions and limitations before enabling any
upload or using media evidence for scoring. The earlier synthetic scoring
experiment failed a known violation case and is not acceptance evidence.
