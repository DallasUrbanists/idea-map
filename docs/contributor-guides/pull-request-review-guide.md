# Review a pull request

When you review a pull request, you help the author check that the change works
for people using Idea Map and fits the project. This guide walks you through
understanding the change, checking its behavior and documentation, and leaving
feedback the author can act on.

The following contents links navigate within this guide:

- [Understand the change](#understand-the-change)
- [Read the diff in context](#read-the-diff-in-context)
- [Validate the behavior](#validate-the-behavior)
- [Check the documentation](#check-the-documentation)
    - [Check coverage and requirements](#check-coverage-and-requirements)
    - [Read and verify the instructions](#read-and-verify-the-instructions)
- [Leave helpful feedback](#leave-helpful-feedback)
- [Finish the review](#finish-the-review)
- [Further reading](#further-reading)

## Understand the change

You should start with the problem the author is trying to solve:

1. Read the description, linked issue, acceptance criteria, and existing review
    discussion so you understand the expected result and scope.
2. Confirm the target branch follows [CONTRIBUTING.md](../../CONTRIBUTING.md)
    and note the head commit you're reviewing so your findings and checks refer
    to the same revision.
3. Read the relevant architecture and policies through the
    [documentation index](../README.md).
4. Ask about consequential gaps in the requirements before assuming how a user
    flow, permission, or data change should work.

Agents must also follow [AGENTS.md](../../AGENTS.md) when reviewing changes.

Documentation describes the intended system and sets the project's requirements.
You should review the affected behavior against those requirements and consider
intentional policy changes together with their implementation. Keep requests
focused on this change, and identify unrelated improvements as follow-up work.

## Read the diff in context

You should review the complete change, including the surrounding code:

- Follow the main user or data flow through application code, shared packages,
    tests, configuration, and documentation rather than reading each file alone.
- Check that code respects the
    [workspace boundaries](../architecture/architecture-overview.md#workspace-boundaries)
    and uses existing package exports, components, and design tokens.
- Look for clear names, understandable control flow, and comments that explain
    reasons or constraints instead of repeating the code.
- Inspect dependency and lockfile changes, generated migration SQL, journals,
    snapshots, and built-package contracts when those files are affected.
- Check permission failures, private-data exposure, retries, concurrency, and
    recovery against the [API policy](../policies/api-policy.md) and the other
    policies relevant to the change.

Passing checks do not replace reading the code. You should look for failure
paths that ordinary examples miss, especially authorization, side effects, and
what happens when a dependency is unavailable.

## Validate the behavior

You should choose evidence that demonstrates the behavior being changed:

1. Compare the author's reported checks with the
    [testing guide](testing-guide.md), including everyday checks for code or
    shared configuration and the affected package or integration checks.
2. Read changed tests and confirm their assertions would catch the relevant
    failure. Prefer meaningful behavior checks over tests that mirror the
    implementation or duplicate the same assertion at every layer.
3. Reproduce the important behavior or review a recorded demonstration, using
    the [development guide](development-guide.md) when local services are needed.
    Use a separate checkout if necessary to preserve your existing work.
4. For interface changes, check the affected stories, keyboard access, focus,
    small-screen layout, and loading, empty, error, and disabled states.
    Investigate visual differences before accepting a changed baseline.
5. Check changesets and compatibility against the
    [release procedure](../policies/release-procedure.md). Documentation-only
    changes without delivered behavior need no changeset or application build.

You should use synthetic fixtures, disposable test databases, and the documented
local workflow, then stop services you started using the
[shutdown steps](development-guide.md#end-of-each-work-session). Review does not
authorize deployment, publication, permission changes, or production access.

You should record which checks you ran yourself, which results the author
provided, and any validation gaps. Confirm that automated results, when
available, cover the revision you're reviewing; a passing result alone does not
establish that every affected behavior was checked.

## Check the documentation

Documentation is part of the review even when the pull request mainly changes
code. You should use the
[documentation review checklist](documentation-style-guide.md#documentation-review-checklist)
and complete the coverage and instruction checks in the following sections.

### Check coverage and requirements

You should identify the documents readers need for the changed behavior:

1. Check whether setup, configuration, commands, architecture, policies, package
    README files, API comments, stories, and release notes need updates in the
    same pull request.
2. For a new or changed user task, check that the matching how-to guide is added
    or updated under `docs/user-guides/`, following the
    [user-guide rules](documentation-style-guide.md#user-guides).
3. Confirm that documentation describes the intended behavior in the present
    tense and agrees with the affected code and policies. Raise disagreements
    instead of weakening a requirement to match an implementation gap.
4. Keep historical [migration records](../v1-migration/README.md) separate from
    current requirements, and check that no guidance is duplicated across
    competing sources.

### Read and verify the instructions

You should check the documentation as someone relying on it to complete a task:

1. Read for a clear audience, useful prerequisites, warm language, and explicit
    subjects, including shared subjects in list introductions and the local
    meanings of modal verbs.
2. Check the two-sentence list-item limit, heading hierarchy, and contents links
    to every section and subheading, with subheadings in indented link lists.
3. Compare commands, scripts, paths, configuration loading, and success indicators
    with the repository. Check setup, startup, and shutdown where instructions
    run services, including which checkout and data are affected.
4. Render changed Markdown and follow local links and heading anchors, including
    links affected by new, moved, or renamed files. Check alternative text and
    information that would otherwise depend on color or images.
5. Read user guides without relying on developer knowledge, and compare the
    steps with the interface or a recorded walkthrough when a workflow changes.
    Wording-only edits need reading, rendering, and link checks rather than an
    application build.

You can check whitespace in the pull request's commit diff from the repository
root with Git's three-dot comparison:

```sh
git diff --check BASE_COMMIT...HEAD_COMMIT
```

You should use commit identifiers from the pull request. Replace the following:

- Replace `BASE_COMMIT` with the target branch's commit identifier at review time.
- Replace `HEAD_COMMIT` with the pull request's head commit identifier you reviewed.

Both commits must exist in the review checkout. The three-dot form compares the
head with its merge base with the target, so the check covers the pull request's
changes rather than just unstaged local edits.

## Leave helpful feedback

You should make it clear what needs fixing and why:

- Comment on the relevant lines and explain the effect on behavior, readers,
    security, or maintenance, linking the project requirement when one applies.
- Separate required fixes from optional suggestions and personal preferences.
    Give a concrete next step or ask a focused question when the intent is unclear.
- Focus on the change rather than the author, and keep requests proportionate
    to the problem instead of asking for unrelated cleanup.
- Group related comments into a coherent review and raise important design or
    correctness concerns early so the author can act on them.

You should keep credentials and private data out of review comments. Report
security-sensitive findings privately to a maintainer, following
[CONTRIBUTING.md](../../CONTRIBUTING.md#using-ai-tools).

## Finish the review

You should finish with a review that the author and other reviewers can follow:

1. Summarize what you checked, what evidence you used, and any remaining blockers
    or validation gaps.
2. Approve when the affected requirements are met and blocking concerns are
    resolved, request changes for unresolved required fixes, or leave a comment
    when you're asking for clarification without approving.
3. Recheck fixes and new commits before relying on your earlier assessment.
    Repeat the checks affected by those changes and record the revision checked.

Approval does not itself merge, publish, or deploy a change. Maintainers should
follow the contribution and release workflows for those separate actions.

## Further reading

You can read Google's
[code review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
for general review practices and GitHub's
[pull-request review instructions](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)
for the review interface. The project-specific requirements and steps are
described here and in the linked repository guides.
