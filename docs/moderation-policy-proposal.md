# Proposed moderation policy and review workflow

**Policy proposal; implementation and provider setup are still required.**

This document addresses [#52](https://github.com/DallasUrbanists/idea-map/issues/52).
Implementation belongs to [#53](https://github.com/DallasUrbanists/idea-map/issues/53)
and [#55](https://github.com/DallasUrbanists/idea-map/issues/55).

## Decision proposed

Use the compliance score to give moderators time to review riskier submissions
before automatic publication:

- **Below 60%:** human approval is required. Time alone cannot approve the submission.
- **60% to below 95%:** wait up to 24 hours, with a shorter wait for a higher score.
  Automatically approve when the wait expires if no moderator has intervened.
- **95% or greater:** eligible for instant automatic approval.
- **Trusted verified users:** keep the earlier instant-approval shortcut, with a
  threshold that falls from 95% to 90% as their approval history grows.

The standard schedule applies to registered users and guests, including unverified
submitters. It replaces the previous fixed six-hour gate and verification-only
automatic approval rule. The [moderation wiki](https://github.com/DallasUrbanists/idea-map/wiki/Moderation-and-Publication)
describes the earlier direction; its six-hour eligibility rule must be synchronized
with this proposal before rollout.

Moderators can review a submission as soon as it is accepted. The waiting period
is an opportunity for intervention, not a delay before moderators may act.
Rejection always requires a human decision.

New submissions and pending edits stay private until approved. Publication exposes
only approved content and permitted media. Contact information and reviewer notes
stay private after publication too.

## Waiting period

For a complete, valid compliance score `c` from 60% to below 95%, calculate:

```text
wait in hours = 24 × (95 - c) / 35
auto-approval time = assessment receipt time + wait
```

The score uses percentage points: enter `80` for 80%. This is linear interpolation
from 24 hours at exactly 60% to zero hours at exactly 95%. Scores below 60% have
no automatic-approval time; scores of 95% or greater have a zero wait.

| Compliance score | Standard waiting period |
| --- | --- |
| Below 60% | Human approval required |
| 60% | 24 hours |
| 68.75% | 18 hours |
| 77.5% | 12 hours |
| 86.25% | 6 hours |
| 90% | About 3 hours 26 minutes |
| 95% or greater | No waiting period |

Use the stored score before display rounding and the calculated timestamp rather
than rounding the wait down. Start the clock when the server receives, validates
and durably records a complete assessment for the exact current revision, including
all required media checks. Use this server-recorded receipt timestamp, not the
submission time, provider's timestamp or a browser-supplied time. Make the score
and deadline available to moderators when the assessment is recorded.

Time spent waiting for an assessment does not consume the review window. For
example, a 60% score received two hours after submission starts a full 24-hour
review window at receipt. The 24-hour maximum describes the wait after assessment;
total submission-to-publication time can be longer during assessment or service
delays. Schedule a durable job for the deadline; retry delayed jobs without
restarting the clock.

A missing or incomplete assessment never starts the clock. A new assessment that
supersedes the current one starts a fresh window from its own receipt timestamp
and invalidates the old deadline. Duplicate delivery of the same assessment does
not reset its timestamp or extend the wait. An edit invalidates the pending
revision's assessment and timer; its replacement needs a new assessment before
its clock starts.

## Trusted-user shortcut

A verified user's trusted-user score is the number of distinct prior approved
submissions in their history. Use the server's approval records for the same
verified submitter identity; never accept a count supplied by the browser.

Count each submission once, whether its approval was automatic or human.
Reapproving an edit, retrying an approval or processing the same event twice
does not add another submission. Exclude the submission currently being assessed,
so its earlier approved revisions cannot lower the threshold for its own edits.
If an approval is reversed for a moderation violation, remove that submission
from the count used for future decisions. Rejected and pending submissions do
not contribute.

For a count `n`, calculate the threshold in percentage points:

```text
trusted-user instant-approval threshold = 95 - 0.5 × min(n, 10)
```

This is linear interpolation between zero and ten approvals, capped at a minimum
threshold of 90%.

| Prior approved submissions | Instant shortcut requires a compliance score |
| --- | --- |
| 0 | > 95% |
| 1 | > 94.5% |
| 2 | > 94% |
| 3 | > 93.5% |
| 4 | > 93% |
| 5 | > 92.5% |
| 6 | > 92% |
| 7 | > 91.5% |
| 8 | > 91% |
| 9 | > 90.5% |
| 10 or more | > 90% |

Calculate the count and threshold again when approval is committed. Record that
snapshot with the decision so later changes to history do not rewrite past
decisions. If history cannot be read reliably, do not use the shortcut; use the
standard waiting schedule instead. The shortcut requires server-confirmed email
verification and submission ownership. It only shortens the wait; the checks and
moderator holds described below still apply. A verified user's score must
strictly exceed this shortcut threshold. The standard rule already gives everyone
instant approval at 95% or greater, including exactly 95%.

## Compliance score and approval conditions

The compliance score is a project-level score from 0% to 100%, where a higher
score means greater confidence that the submission meets the content rules.
Assess the whole revision, including text, captions, photos and generated assets.
A strong text score cannot compensate for an unassessed photo.

Google's text category confidence and SafeSearch likelihoods are inputs, not a
ready-made compliance percentage. Do not assume that subtracting a harmful-category
score from 100 produces this score, or assign arbitrary percentages to SafeSearch
labels. Define, version and evaluate the scoring method against the content rules
before using it for automatic approval.

Automatic approval requires all of the following:

- All required checks have completed for the exact current revision and its media.
- The compliance score is a finite number from 0% to 100% and is at least 60%.
- The standard deadline has arrived, or the verified-user shortcut applies.
- No moderator decision, hold or request for changes blocks approval.
  Withdrawn or removed submissions cannot be approved.

At approval time, recheck the revision, current assessment, deadline and moderation
state atomically. Recheck verified identity, ownership and history when using the
trusted-user shortcut. If that shortcut no longer applies, fall back to the
standard deadline; loss of the shortcut alone does not permanently block approval.

Missing or unknown scores, unsupported input, incomplete scans and provider failures
require manual review until a valid assessment is available. If the scoring method
cannot assess a required rule, route to human review. A score below 60% never causes
automatic rejection; it requires a moderator's approval or rejection.

## Human intervention

Before the deadline, a moderator can approve early, reject, request changes or place
a review hold. Each action records an actor, timestamp and reason. A hold or request
for changes prevents timer-based publication until a moderator explicitly resolves
it. Merely opening the submission page does not count as a review decision or hold.

Classifier risk flags prioritize the queue and contribute to the compliance
assessment. A flag alone does not indefinitely block an otherwise eligible
submission after its wait. When a moderator finds a violation or needs to
escalate a case, they must record a decision or an explicit hold with an owner
and reason rather than relying on silent queue placement.

When the timer and a moderator action race, the publication transaction must honor
any blocking action committed before approval. After publication, moderators can
remove content and invalidate its public projections if a violation is discovered.

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

## Candidate providers and review priority

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

Use these provider signals as inputs to the score and to queue priority:

| Signal | Review priority |
| --- | --- |
| Text Toxic, Derogatory, Violent or Sexual confidence >= 0.75; or image adult or violence `LIKELY`/`VERY_LIKELY` | High-priority contextual review |
| Those text categories >= 0.40 and < 0.75; or image adult or violence `POSSIBLE` | Contextual review |
| Unsupported language, missing/unknown result, provider error, timeout or unscannable media | Assessment unavailable; no automatic approval |

`spoof`, `medical`, `racy`, profanity, politics and other sensitive categories
are not automatic violations. Classifiers do not detect every privacy, harassment
or ownership concern. Evaluate scoring and the waiting schedule on consented or
synthetic, diverse and multilingual examples. Measure missed harmful material,
false flags and whether moderators can act within the proposed windows.

Review provider data handling, region, retention, terms, access and costs before
sending private content to a provider.

## Revisions and publication

1. Save an accepted submission privately with its revision acceptance timestamp.
   Make it available to moderators immediately and assess that exact revision.
2. On receipt of a complete, valid assessment for the current revision, atomically
   record its identity, server receipt timestamp, score and calculated deadline.
   Start the review clock then. Apply the trusted-user shortcut only when its
   server-side conditions pass.
3. At the deadline, automatically approve only if the revision still qualifies
   and no moderator intervention blocks it. Bind both human and automatic approval
   to the exact revision and its permitted media.
4. An edit creates a private pending revision that requires a new assessment.
   Its clock starts on receipt of that assessment, not when the edit is saved.
   Keep the last approved revision public until the replacement is approved or
   the submission is withdrawn or removed. Old assessments and scheduled jobs
   cannot approve a newer revision or supersede its current assessment.
5. Publish only the approved revision. Invalidate public caches, previews and
   projections on replacement, withdrawal or removal. Rejected and superseded
   assets remain private and follow the approved retention schedule.

## Audit, privacy and reviewer accountability

Keep an append-only record of the revision, acceptance time, assessment identity,
server-recorded assessment receipt time, compliance score, scoring-method version,
calculated deadline, policy version,
approval method, service or moderator identity, and reason. Record moderator holds,
decisions and overrides. For the trusted-user shortcut, also record the verified
identity evidence, prior approval count and threshold used.

Record provider identifiers, category signals and failure states only as needed
for review. Keep raw content, contact details, credentials and full provider
payloads out of logs. Restrict audit access to authorized staff.

Propose retaining decision metadata for **90 days**, subject to operator and legal
review. Define trust-history retention and corrections separately so expiring audit
records do not corrupt approval counts. Uploads and account data follow separate
retention rules. Define lawful holds and deletion exceptions before implementation.

## User-facing messages and appeals

- Waiting: “Your idea is saved privately. It is scheduled for automatic review
  completion at [time], unless a moderator requests changes or places it on hold.”
- Human review required: “Your idea is saved privately and needs a moderator's review.”
- Approved and published: “Your idea has been approved and published.”
- Needs changes: “Your idea needs changes before it can be published. Review the
  feedback and submit an updated version.”
- Rejected: “We could not publish this version because it does not meet our
  content rules. You can review the reason and request another review.”
- Assessment unavailable: “Review is delayed. Your idea remains private while
  we complete the required checks.”

Show the expected time only when a valid assessment establishes a deadline.
Messages must not expose another person's private information, classifier scores
or moderator-only notes. Provide a correction and appeal path; use a different
authorized reviewer for appeals when practicable. Define response targets and a
contact before launch.

## Acceptance scenarios for implementation

| Scenario | Expected result |
| --- | --- |
| Unverified new user, score 98%, complete checks | Eligible for instant automatic approval; no six-hour gate. |
| Score 59.99% | Human approval required; no timer can approve it. |
| Score exactly 60% | Wait 24 hours from receipt of the complete, valid assessment; auto-approve at the deadline if no blocking intervention occurs. |
| Score 77.5% | Standard deadline is 12 hours after receipt of the complete, valid assessment. |
| Score exactly 95% | Eligible for instant automatic approval. |
| Stored score 59.99% displayed as 60% | Use the stored score; no automatic approval. |
| Verified user, five prior approvals, score 92.6% | Above the 92.5% trusted threshold; eligible for instant approval. |
| Verified user, five prior approvals, score exactly 92.5% | Shortcut does not apply; standard wait is about 1 hour 43 minutes. |
| Verified user, ten prior approvals, score 90.1% | Above the 90% trusted threshold; eligible for instant approval. |
| Approval history unavailable | Use the standard schedule; do not grant the trusted shortcut. |
| Moderator approves before the deadline | Publish the approved revision early. |
| Moderator rejects, requests changes or places a hold before the deadline | The timer cannot publish the revision. |
| Moderator only opens the page | No decision or hold exists; the timer still applies. |
| Risk flag, valid score >= 60%, no moderator intervention | Prioritize human review; auto-approve at the deadline if still eligible. |
| Missing image result, unsupported input or provider timeout | Private; no automatic approval without a complete valid assessment. |
| Score 60% arrives two hours after submission | Deadline is 26 hours after submission: the full 24-hour review window starts at assessment receipt. |
| Assessment remains incomplete for 24 hours | No clock starts; keep private until assessment completes or a moderator approves. |
| A new assessment supersedes the current one | Start a fresh window at the new assessment's receipt time and invalidate the previous timer. |
| Duplicate delivery of the same assessment | Preserve the original receipt time and deadline. |
| Approval job runs late | Recheck the current assessment, deadline and moderation state; approve if still eligible without restarting the clock. |
| Edit after publication | Keep the approved version public; assess the pending revision and start its clock only when that assessment is received. |
| Stale job after a second edit | Cannot approve or expose the newer revision. |
| Verification is lost before trusted approval | Fall back to the standard schedule. |
| Duplicate approval event or reapproved edit | Does not increase the trusted-user count. |
| Prior approval reversed for a moderation violation | Correct the trust count for future decisions. |
| Appeal after rejection | Content stays private while a human reconsiders the decision. |

Before rollout, define and evaluate the compliance scoring method, implement durable
timers and atomic moderation/publication transitions, synchronize the wiki, and
complete provider review, retention rules, escalation contacts and appeals.
This document changes the proposed policy; it does not enable a live service.
