# Proposed moderation policy and review workflow

**Proposal for human review — not an approved policy or implemented service.**
This document addresses [#52](https://github.com/DallasUrbanists/idea-map/issues/52).
The user requested a concrete proposal with automatic publication disabled. No
provider, threshold, retention period or message below is approved merely by
appearing here. The existing [moderation direction](https://github.com/DallasUrbanists/idea-map/wiki/Moderation-and-Publication)
keeps new ideas and unapproved media private and retains an approved revision
while edits are reviewed. Implementation belongs to [#53](https://github.com/DallasUrbanists/idea-map/issues/53)
and [#55](https://github.com/DallasUrbanists/idea-map/issues/55).

## Decision proposed

Use **human approval for every publication and rejection**. A classifier may
prioritize the private review queue; a low score never approves content and a
high score never rejects it. Automatic publication remains disabled until a
separate approved policy, evaluation and implementation authorize it. Protect
ideas, contact information, photos, generated assets, pending revisions and
reviewer notes from public APIs, caches, previews and storage until approved.
Eligibility is not approval: unverified guest submissions wait at least six hours;
verified guests and verified registered users can become eligible immediately.

## Proposed content rules

Moderators assess the whole submission, captions and each image in context.
Allow good-faith civic criticism, political viewpoints, descriptions of unsafe
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

Initial **queue-routing proposals**, subject to evaluation and approval:

| Signal | Proposed routing | Decision |
| --- | --- | --- |
| Text Toxic, Derogatory, Violent or Sexual confidence >= 0.75; or image adult or violence `LIKELY`/`VERY_LIKELY` | High-priority human review | No automatic reject or publish |
| Those text categories >= 0.40 and < 0.75; or image adult or violence `POSSIBLE` | Human review with contextual flag | No automatic reject or publish |
| Below those thresholds | Normal human review | No automatic publish |
| Unsupported language, missing/unknown score, malformed result, provider error, timeout or unscannable media | Manual review with an explicit unavailable flag | Never treat as clean |

`spoof`, `medical`, `racy`, profanity, politics and other sensitive categories
are not automatic violations. Reviewers may consider them in context, and image
classifiers do not detect all text in images, privacy issues, harassment or
ownership concerns. Scores are proposed triage thresholds, not calibrated
probabilities or a safety guarantee. Evaluate on consented/synthetic, diverse
and multilingual examples before use; measure missed harmful material, false
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
3. An authorized moderator explicitly approves, rejects or requests changes with
   a reason. Approval atomically binds the decision to the reviewed revision and
   its permitted media. Publication and cache/projection invalidation must use
   that approved revision only. A withdrawn or removed item is unavailable and
   its public projections/previews are invalidated.
4. Editing published material creates a private pending revision. Keep the last
   approved revision public until a new revision is approved or the item is
   withdrawn/removed; never overwrite the public version with pending content.
   Review new photos, generated content and accepted clarification transcripts
   under their respective policy before publication. Rejected or superseded
   assets remain private and follow the approved deletion/retention schedule.

## Audit, privacy and reviewer accountability

Propose an append-only decision record containing idea/revision identifiers,
eligibility and event timestamps, actor or service identity, policy version,
provider/feature/model identifiers where supplied, outcome, reason code and
reviewer override. Record classifier categories/threshold version and failure
state only as needed for review; avoid raw content, contact details, tokens and
provider payloads in logs. Access is restricted to authorized staff and audited.
Propose retaining decision metadata for **90 days**, subject to legal and operator
review; raw uploads and account data follow separate, approved retention rules.
No retention job is implemented here. Document a lawful hold and deletion
exception process before implementing it; do not imply an unapproved retention
period is operational.

## User-facing messages and appeals

- Waiting: “Your idea is saved privately and is waiting for review.”
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
| Verified submitter, low classifier scores | Eligible for normal human review; never automatically published. |
| Political criticism or a photo flagged `POSSIBLE` | Contextual human review; no rejection on score alone. |
| Timeout, unsupported language or missing image result | Private and routed to manual review with failure evidence. |
| Edit after publication | Original approved revision stays public; new text and media remain private until a reviewer approves that exact revision. |
| Stale worker result after a second edit | Cannot approve or expose the newer revision. |
| Rejection followed by appeal | Private content remains private; reason and appeal are auditable without exposing private reviewer notes. |

Before implementation, reviewers must approve the rules, provider terms and
data handling, thresholds/evaluation plan, retention, escalation contacts,
appeal process and publication transition. This proposal does not provision a
cloud service, change access controls, run a live model or enable publication.
