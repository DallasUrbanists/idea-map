# Open MVP beta release policy

The open *minimum viable product (MVP)* beta lets people try Idea Map's core
browse-and-submit experience and share feedback. The site is publicly
accessible, with promotion focused on personal invitations to stakeholders and
potential supporters.

The following contents links navigate within this guide:

- [Release scope](#release-scope)
- [Publication and private data](#publication-and-private-data)
- [Essential safeguards](#essential-safeguards)
- [Later work](#later-work)
- [Launch acceptance](#launch-acceptance)
- [Decisions before enabling features](#decisions-before-enabling-features)

## Release scope

People can locate an idea, add text and supported photos, recover an interrupted
draft, submit, and view the resulting post in map/list browsing and on a stable
detail page. The beta includes an accessible feedback route and clear
acknowledgment of save, publication, failure, and retry states.

Posts publish immediately after durable acceptance and required technical
validation. The beta does not use pre-publication content review, compliance
scoring, trusted-user approval thresholds, or moderation waiting periods.
Technical validation includes authorization, consent, input and upload checks;
it does not assess an idea's viewpoint or require a reviewer to approve it.

Account-optional submission, guest quotas, verification and ownership remain
separate from publication. Publishing a post does not verify its author's email
or grant ownership to a person who enters that address.

## Publication and private data

The publication transaction must bind a public post to the exact submitted
revision and permitted media, record that it was published under beta rules, and
preserve retry safety. The service must not invent a passing compliance score,
moderator decision, or reviewed status for content published without review.

Drafts, incomplete uploads, contact details, ownership evidence, credentials,
and staff-only records remain private. An edit becomes public only through an
authorized, explicit submission of that revision; autosaving a draft must not
change the public post.

The beta publication path must preserve withdrawal and removal restrictions and
reject stale revisions. The service must not enable the separate score-based
publication path as a side effect of enabling beta posting.

## Essential safeguards

Operators should retain the following protections for the public beta:

- Server-side authorization for each owner, guest and staff operation, with
  private fields excluded from public API, HTML, media and log output.
- Bounded input, submission, verification-email and upload requests, including
  file-type and actual-image validation and technical resource limits.
- The selected static JPEG, PNG and WebP photo formats and limit of ten photos
  with captions, with separately reviewed byte and dimension limits.
- A monitored report/removal contact, an authorized removal operator, and a
  tested way to pause new posting during abuse or an incident.
- Removal of controlled public copies, including media and previews, without
  requiring the full pre-publication moderation workflow.
- Applicable data-handling and consent requirements, recoverable deployment,
  backups and a demonstrated restore that does not republish removed content.

The service uses `private, no-store` for real user content until effective
shared-cache invalidation is accepted. Operators should apply the
[Privacy Policy](privacy-policy.md#retention-and-deletion), including authorized
removal deadlines and restricted legal holds; beta status does not change them.

Operators should keep unused providers and optional processing disabled.
The separate review of Gemini use, data handling, terms and operating limits
remains a prerequisite for enabling that processing.

## Later work

The following work does not block this beta unless the release explicitly
enables or promises it:

- Full review queues, compliance scoring, trusted-user history and timed
  approval.
- Dictation, clarification conversations, generated diagrams and richer
  enrichment.
- Discussion, likes, follows, notifications, analytics and real-time
  projections.
- Streetmix and renderer package releases, presentation modes and complete
  predecessor-service parity.
- Migration, domain cutover and retirement of the existing service.
- Shared content caching and full contributor-platform or catalogue acceptance.

Contributors should retain the existing acceptance criteria for those features.
A later release must satisfy its own publication, privacy, accessibility and
operational requirements before enabling them.

The [proposed participant notice](beta-participant-notice.md) preserves review
copy for the welcome and submission contexts.

## Launch acceptance

Maintainers should use the [beta acceptance procedure](../test-procedures/beta-acceptance.md)
to review the actual release candidate, record limitations and make a launch
decision. A completed foundation issue, selected domain, screenshot or successful
unit test does not establish that the complete public journey works.

Deployment, credentials, permissions and production changes retain their
separate authorization requirements. Documentation acceptance does not itself
authorize those operations or assert that the beta is live.

## Decisions before enabling features

Maintainers should record these bounded decisions before the affected feature
is enabled:

- Upload byte and dimension limits, request quotas, and the responsible person
  for reports, removals and incident response.
- Retention and cleanup for the data the beta actually collects, including
  abandoned drafts and uploads; established removal deadlines remain unchanged.
- The accepted terms version, rollout of revised public-content wording, and
  the disposition of independent terms/privacy review.
- The feedback destination and any optional demo feature included in the beta.

The publication mechanism and representation of beta provenance require
implementation review. This policy does not prescribe a configuration variable,
reuse a reviewed status incorrectly, or weaken existing authorization.
