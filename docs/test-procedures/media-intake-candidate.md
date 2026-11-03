# Evaluate synthetic media intake

Contributors and reviewers can use this procedure to evaluate media intake with
synthetic files and verify authorization, revision binding, recovery, and
assessment safeguards. These safeguards and the evaluation requirements define
the project standard. Upload limits and provider behavior remain subject to the
explicit decisions and evidence described here; this procedure does not authorize
enabling uploads or accessing staging.

The server must provide a complete, verified inventory of the media belonging to
a revision. Moderators must review every required asset in that revision, and the
scoring gate must not treat an invented or unverified inventory as evidence.

The following contents links navigate within this procedure:

- [When to use this guide](#when-to-use-this-guide)
- [Limits requiring a decision](#limits-requiring-a-decision)
- [Identity and recovery](#identity-and-recovery)
- [Synthetic evaluation](#synthetic-evaluation)
- [Decisions and provider evidence](#decisions-and-provider-evidence)

## When to use this guide

The following situations call for this evaluation:

| When this happens... | Use this guide to... |
| --- | --- |
| You implement or change media intake or draft recovery | Verify authorization, exact revision and object-generation binding, and retry behavior with synthetic files |
| You evaluate upload limits or a storage provider | Record unresolved choices and distinguish local evidence from separately authorized provider tests |
| You review media for moderation or scoring | Confirm incomplete or unverified media cannot pass assessment or automatic publication |

## Limits requiring a decision

The submission flow supports at most ten images with captions, as required by the
[submission issue](https://github.com/DallasUrbanists/idea-map/issues/50).
Reviewers should use JPEG, PNG, and WebP images and a 10 MiB (10,485,760 bytes)
per-image boundary as synthetic evaluation inputs. The public-preview types do
not establish accepted source formats, and the 10 MiB boundary is an unresolved
product choice, not an upload policy. That boundary permits up to 100 MiB of
source files before generated files or retries, so reviewers should assess
storage, bandwidth, and moderator workload before recording a limit decision.

The server must issue upload access only for an authorized draft's opaque,
create-only pending object and enforce the recorded size bound. The signing
helper allows an authorization lifetime of at most 15 minutes. A resumable upload
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

Reviewers should use a disposable local database and storage fake first, with no
production content, buckets, identities, or credentials. Reviewers should record
the evaluated limits and reproducible outcomes for all of these cases:

1. Zero, one, ten, and eleven images; exact-limit and over-limit files; each
   evaluated type; mismatched bytes and declared types; invalid, truncated, and
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
synthetic files and test-only identities. Reviewers should record the exact
project, region, object generations, session behavior, permissions, cleanup ownership, and
observed results; a fake cannot establish those provider properties. Reviewers
should follow the [media staging procedure](../policies/media-staging-procedure.md) only after
separate authorization for its actual staging access and changes.

## Decisions and provider evidence

Before enabling uploads, the project owner and relevant reviewers should record
decisions on the formats and byte limits, animation and metadata handling, safe
pixel/decoder bounds, resumable protocol and supported clients, retention and
cleanup deadlines, and recovery and abuse limits. Review actual provider terms,
region, access, session lifetime, and deletion/backup behavior for the
selected environment. Document decisions and limitations before enabling any
upload or using media evidence for scoring. A synthetic scoring result that fails
a known violation case is not acceptance evidence.
