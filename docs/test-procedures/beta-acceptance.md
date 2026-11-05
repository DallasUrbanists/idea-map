# Accept the open MVP beta

Maintainers can use this procedure to decide whether a release candidate is
ready for the open MVP beta. Reviewers test the complete browse-and-submit
journey and the protections needed for public use, while leaving later features
under their own acceptance gates.

The following contents links navigate within this guide:

- [When to use this guide](#when-to-use-this-guide)
- [Prepare the review](#prepare-the-review)
- [Core journey](#core-journey)
- [Public and private boundaries](#public-and-private-boundaries)
- [Abuse and operational recovery](#abuse-and-operational-recovery)
- [Notice and consent](#notice-and-consent)
- [Record the decision](#record-the-decision)
- [Finish the review](#finish-the-review)

## When to use this guide

| When this happens... | Use this guide to... |
| --- | --- |
| A release candidate is ready for beta review | Test the scoped public journey and record remaining launch blockers. |
| Publication, uploads, ownership or removal changes | Repeat the affected privacy and recovery checks. |
| The beta adds an optional feature or provider | Identify and satisfy the extra acceptance requirements before enabling it. |

## Prepare the review

Reviewers should prepare an isolated environment and record the candidate:

- [ ] Record the immutable commit or image, environment, enabled features and
  publication mode.
- [ ] Confirm the environment and test accounts are isolated from production
  and the existing service, using synthetic ideas, photos and identities.
- [ ] Identify the operator, rollback procedure, report destination and cleanup
  procedure before testing.
- [ ] Resolve the feature-specific decisions in the
  [beta release policy](../policies/beta-release-policy.md#decisions-before-enabling-features).

Reviewers should follow the [development guide](../contributor-guides/development-guide.md)
when local services are needed and the relevant hosted procedure for separately
authorized provider checks. Application startup is unnecessary for a prose-only
review.

## Core journey

Reviewers should demonstrate these outcomes through the actual application:

- [ ] Locate an idea, enter text and supported photos/captions, review the
  public fields, submit and open the resulting stable detail link.
- [ ] See the accepted post in map and list views immediately without a
  content-review queue or score dependency.
- [ ] Refresh or interrupt entry, upload and submission, then recover the
  draft and retry without duplicating a post or consuming guest allowance twice.
- [ ] Complete the supported guest and account paths, including a
  registered-email login interruption without losing draft content.
- [ ] Navigate the core controls with a keyboard and an accessible name, recover
  focus after overlays, and complete the journey at a narrow mobile viewport.
- [ ] Receive useful empty, loading, invalid-input and provider/network failure
  states without treating an uncertain save as a definite failure or success.

## Public and private boundaries

Reviewers should use distinct synthetic owners, a guest, an unauthorized person
and an authorized operator:

- [ ] Confirm explicit publication targets the exact revision/media and records
  beta provenance without a fabricated score or review decision.
- [ ] Verify drafts, unfinished uploads, email addresses, ownership evidence and
  staff-only information never appear in public API, HTML, media or logs.
- [ ] Deny cross-owner edits, guessed private identifiers, forged roles and
  invalid or revoked credentials before side effects.
- [ ] Verify guest capabilities and registered-email claims without granting
  ownership from an unverified email string.
- [ ] Exercise authorized edits and repeated/stale requests without publishing
  autosaved drafts or restoring withdrawn or removed content.
- [ ] Reject unsupported, mislabeled, malformed and oversized uploads, and
  demonstrate the reviewed photo-count, dimension and byte limits.
- [ ] Confirm production credentials and private data are absent from public
  client assets, error output and test evidence.

## Abuse and operational recovery

Reviewers should demonstrate a bounded failure and response:

- [ ] Reach the report/removal contact, identify the responsible operator, and
  confirm the operator has a documented handling and escalation procedure.
- [ ] Remove a synthetic post as an authorized operator and verify its HTML,
  API, photos, previews and any enabled projections stop being public.
- [ ] Confirm real-content responses use `private, no-store` unless an accepted
  invalidation design covers every enabled shared public surface.
- [ ] Exercise request, email and upload limits, retry bounds and provider
  quotas without load-testing production.
- [ ] Pause new posting through the documented operator procedure, verify the
  public state and recovery message, and restore the previous setting.
- [ ] Rehearse rollback and isolated restore against the accepted 24-hour
  data-loss and 24-hour recovery targets, preserving removal restrictions.
- [ ] Verify useful health/error signals, resource limits and a response owner
  without logging raw submissions, credentials or private contact details.
- [ ] Confirm unused enrichment/moderation providers remain disabled and that
  any enabled background task has suitable retry and recovery evidence.

## Notice and consent

Reviewers should verify what users are told before sharing content:

- [ ] Show that posts are public immediately and not reviewed before
  publication, with a readable link to the applicable Terms and Privacy Policy.
- [ ] Retain the unchecked per-submission rights/terms agreement and the exact
  accepted text/version and server timestamp through retries and ownership
  claims.
- [ ] Serve a new immutable beta terms snapshot/version that matches the form,
  API and retained consent; preserve the historical initial terms and update
  the corresponding consent tests.
- [ ] Preserve previously accepted terms and private drafts; revised wording
  alone must not republish old submissions or create consent retroactively.
- [ ] Provide an accessible feedback path and a notice that does not promise
  guaranteed security, reliability or real-time emergency response.
- [ ] Record the maintainer's decision about independent terms/privacy review
  and any remaining conditions, without publishing privileged advice.

The registered-submission test currently compares retained consent text with both
`packages/server/terms/initial-terms.md` and `docs/policies/terms-of-use-policy.md`.
The revised policy text therefore creates a mismatch until the new immutable beta
terms version, serving, and consent tests are implemented together. The initial
snapshot and previously recorded consent must remain unchanged.

## Record the decision

Maintainers should record the following fields with the acceptance evidence:

| Field | Required record |
| --- | --- |
| Candidate and scope | Commit/image, environment, enabled features and beta publication behavior. |
| Evidence | Links to relevant automated checks, browser journeys and authorized hosted rehearsals. |
| Failures | Failed, unrun or inconclusive checks and their user impact. |
| Limitations | Deferred features and operational limitations shown to participants. |
| Owners | Launch decision-maker, report/removal operator and recovery operator. |
| Decision | Accepted, accepted with explicit conditions, or blocked; date and reasons. |

Unchecked required safeguards remain blockers. Maintainers should distinguish a
deferred feature from a broken enabled feature and should not use a disclaimer
as evidence that privacy or security checks passed.

## Finish the review

Reviewers should remove only test-owned data through the documented cleanup,
restore temporary settings and stop services started for the review.
Reviewers should preserve evidence without private content and record any cleanup
that could not be completed safely.
