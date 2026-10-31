# Proposed moderation policy and review workflow

**Proposal for human review — not an approved policy or implemented service.**
This document addresses [#52](https://github.com/DallasUrbanists/idea-map/issues/52).
This proposal allows automatic approval for verified users when their submission's
compliance score is strictly greater than 95%. It describes the intended policy;
implementation, score evaluation and provider setup are still required.
The existing [moderation direction](https://github.com/DallasUrbanists/idea-map/wiki/Moderation-and-Publication)
keeps new ideas and unapproved media private and retains an approved revision
while edits are reviewed. Implementation belongs to [#53](https://github.com/DallasUrbanists/idea-map/issues/53)
and [#55](https://github.com/DallasUrbanists/idea-map/issues/55).

## Decision proposed

**Auto-approve submissions from verified users when their compliance score is
strictly greater than 95%.** A score of exactly 95% goes to human review.
All other submissions require human approval; rejection always requires a human
decision.

A verified user means a registered user or guest whose email verification and
ownership of the submission have been confirmed by the server. Check that status
again when approving; a browser-supplied flag is insufficient. Unverified guest
submissions wait at least six hours before human review. Waiting six hours alone
does not qualify a submission for automatic approval.

New submissions and pending edits remain private until approved. Publication
exposes only the approved content and permitted media; contact information and
reviewer notes stay private after publication too.

## Proposed content rules

Both automated checks and moderators assess the whole submission, captions and
each image in context. Allow good-faith civic criticism, political viewpoints, descriptions of unsafe
streets and discussion of public officials; disagreement or an AI category alone
is not grounds for rejection. Do not publish material containing:

- credible threats, incitement to violence or targeted harassment;
- hateful attacks on protected characteristics, or explicit sexual material;
- private contact information, precise personal identifiers or intimate images
  disclosed without a clear right to publish them;
- spam, fraud, malware links or material the submitter lacks permission to share.

Escalate ambiguous privacy, ownership, safety and contextual cases to a second
moderator. Do not infer a legal conclusion, protected status, intent or permission
from a model score. Where a concern is limited to one field or photo, offer a
correction path; do not silently edit the author's meaning. Emergency or credible
threat handling requires an operator-approved escalation contact and procedure;
do not promise real-time monitoring or automated emergency response.

## Compliance score and automatic approval

The compliance score is a project-level score from 0% to 100%, where a higher
score means greater confidence that the submission meets the content rules.
It must cover the exact revision, including its text, captions, photos and
generated assets. A strong text score cannot compensate for a flagged photo.

Google's text category confidence and SafeSearch likelihoods are inputs, not a
ready-made compliance percentage. Do not assume that subtracting a harmful-category
score from 100 produces this score, or assign arbitrary percentages to SafeSearch
labels. Implementation must define, version and evaluate the scoring method
against the content rules before using it for automatic approval.

Automatic approval requires all of the following:

- The server confirms the submitter is verified and owns the submission.
- All required checks have completed for the current revision and its media.
- The compliance score is a finite number in the range 0% to 100%, strictly
  greater than 95%, using the
  stored value before display rounding.
- There are no unresolved content flags, privacy or ownership concerns, or
  requests for human review.

A missing score, unsupported input, incomplete scan or provider failure routes to
human review. If the scoring method cannot assess a required rule, the submission
also needs human review. A score of 95% or below never causes automatic rejection.

## Candidate provider and routing thresholds

Propose Google Cloud Natural Language `documents.moderateText`, explicitly
`MODEL_VERSION_2`, for text and Google Cloud Vision SafeSearch for images.
These are candidate managed services, not provisioned integrations or a claim
that the project has accepted their terms. The [text API reference](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/documents/moderateText)
documents category confidence and a severity score for some v2 categories;
[Google's guide](https://docs.cloud.google.com/natural-language/docs/moderating-text)
warns that confidence is a prediction, not a reliable decision or measure of
severity. [Vision SafeSearch](https://docs.cloud.google.com/vision/docs/detecting-safe-search)
returns categorical likelihoods for adult, spoof, medical, violence and racy;
it does not provide the same numeric confidence scale. The Vision API does not
expose a model version in this proposal: record the API feature and any version
the provider actually returns, and reassess changes.

Apply the automatic-approval rule first, with any flags or failures below taking
precedence over the compliance score. Route remaining submissions as follows:

| Signal | Proposed routing | Decision |
| --- | --- | --- |
| Verified user, compliance score > 95%, complete checks and no unresolved flags | Automatic approval | Publish only the scored revision and permitted media |
| Text Toxic, Derogatory, Violent or Sexual confidence >= 0.75; or image adult or violence `LIKELY`/`VERY_LIKELY` | High-priority human review | Blocks automatic approval; no automatic rejection |
| Those text categories >= 0.40 and < 0.75; or image adult or violence `POSSIBLE` | Human review with contextual flag | Blocks automatic approval; no automatic rejection |
| Compliance score <= 95%, or unverified submitter, with no higher-priority flag | Normal human review once eligible | No automatic rejection or publication |
| Unsupported language, missing/unknown score, malformed result, provider error, timeout or unscannable media | Manual review with an explicit unavailable flag | Never treat as clean |

`spoof`, `medical`, `racy`, profanity, politics and other sensitive categories
are not automatic violations. Reviewers may consider them in context, and image
classifiers do not detect all text in images, privacy issues, harassment or
ownership concerns. Provider scores and routing thresholds are not a safety
guarantee. Evaluate on consented/synthetic, diverse and multilingual examples before use; measure missed harmful material, false
flags and reviewer workload, then revise with documented approval. Do not send
private content to a provider until data handling, region, retention, contractual
terms, access and costs have been reviewed and separately authorized.

## State, failure and revisions

1. A durable accepted submission starts **private** and records the eligibility
   time and content revision. It may be saved, waiting, queued, reviewing or
   escalated; none of these states is public.
2. Once eligible, enqueue review with an idempotent key for the exact revision.
   A provider outage, retry exhaustion, unsupported input or stale result routes
   to manual review. Retries are bounded; a later result cannot approve a newer
   revision or unlock public media.
3. The service automatically approves a submission only when it meets every
   automatic-approval condition above. Otherwise, an authorized moderator
   approves, rejects or requests changes with a reason. Both approval paths
   atomically bind the decision to the checked revision and its permitted media,
   rechecking verification, ownership and revision identity at that transition.
   Publication and cache/projection invalidation use that approved revision only.
   A withdrawn or removed item is unavailable and its public projections/previews
   are invalidated.
4. Editing published material creates a private pending revision. Apply the same
   automatic-approval or human-review rules to the new revision. Keep the last
   approved revision public until a new revision is approved or the item is
   withdrawn/removed; never overwrite the public version with pending content.
   Review new photos, generated content and accepted clarification transcripts
   under their respective policy before publication. Rejected or superseded
   assets remain private and follow the approved deletion/retention schedule.

## Audit, privacy and reviewer accountability

Propose an append-only decision record containing idea/revision identifiers,
eligibility and event timestamps, actor or service identity, policy version,
provider/feature/model identifiers where supplied, outcome, reason code and
reviewer override. Record whether approval was automatic or human, the compliance
score and scoring-method version, and the server-verified eligibility evidence.
Record classifier categories/threshold version and failure
state only as needed for review; avoid raw content, contact details, tokens and
provider payloads in logs. Access is restricted to authorized staff and audited.
Propose retaining decision metadata for **90 days**, subject to legal and operator
review; raw uploads and account data follow separate, approved retention rules.
No retention job is implemented here. Document a lawful hold and deletion
exception process before implementing it; do not imply an unapproved retention
period is operational.

## User-facing messages and appeals

- Waiting: “Your idea is saved privately and is waiting for review.”
- Automatically approved: “Your idea has been approved and published.”
- Needs changes: “Your idea needs changes before it can be published. Review the
  feedback and submit an updated version.”
- Rejected: “We could not publish this version because it does not meet our
  content rules. You can review the reason and request another review.”
- Review unavailable: “Review is delayed. Your idea remains private; please try
  again later.”

Messages must not expose another person's private information, classifier scores
or moderator-only notes. Provide a route to correct content and request human
reconsideration; a different authorized reviewer should handle an appeal when
practicable. The operator must define response targets and a contact before
launch; no deadline or support channel is asserted here.

## Acceptance scenarios for implementation

| Scenario | Expected result |
| --- | --- |
| Unverified guest at five hours | Private; not review-eligible yet. |
| Verified submitter, compliance score 95.1%, all checks complete and no flags | Automatically approve and publish the exact scored revision and permitted media. |
| Verified submitter, compliance score exactly 95% or lower | Human review; no automatic approval or rejection. |
| Stored score 95.01% displayed as 95% | Use the stored score; qualifies if all other conditions pass. |
| Unverified submitter, compliance score 99% | No automatic approval; human review after the six-hour eligibility wait. |
| Verified submitter, score 99%, but a photo or privacy concern is flagged | Keep private and route to human review. |
| Political criticism or a photo flagged `POSSIBLE` | Contextual human review; no rejection on score alone. |
| Timeout, unsupported language or missing image result | Private and routed to manual review with failure evidence. |
| Edit after publication | Original approved revision stays public; new text and media remain private until that exact revision receives automatic or human approval. |
| Stale worker result after a second edit | Cannot approve or expose the newer revision. |
| Verification or ownership no longer valid when approval runs | No automatic approval; keep the pending revision private. |
| Rejection followed by appeal | Private content remains private; reason and appeal are auditable without exposing private reviewer notes. |

Before implementation, reviewers must approve the rules, provider terms and
data handling, compliance scoring method and evaluation, retention, escalation
contacts,
appeal process and publication transition. This proposal does not provision a
cloud service, change access controls, run a live model or enable publication.
