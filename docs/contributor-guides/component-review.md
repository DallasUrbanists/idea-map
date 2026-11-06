# Review component patterns

Contributors can use this gate to record focused accessibility and visual
review evidence before a new component pattern is accepted. Use the existing
[Storybook catalog](../architecture/storybook.md) and synthetic examples.

## Status and ownership

Contributors should mark every new pattern **Draft** in its Storybook usage
documentation and pull request. Draft means the pattern is available for review,
not accepted for application use. Existing accepted components do not become
Draft solely because this guide is added. The design reviewer should explicitly
record acceptance for the reviewed revision before a new pattern is labeled
accepted; missing, failed, or unperformed checks remain visible as gaps.

## Focused review

Contributors should select the affected states and representative screen sizes
rather than multiplying every story across every device. Reviewers should check:

- Keyboard operation, visible focus, focus order, dismissal, and focus restoration
  where applicable, including interrupted and repeated interactions.
- Text contrast against its actual background and contrast of essential
  interactive boundaries and focus indicators in the affected themes and states.
- Accessible names, roles, state, and label/error associations in the
  accessibility tree, followed by a real screen-reader walkthrough when relevant.
- Reduced-motion behavior with the system preference enabled, including whether
  essential state changes remain understandable without animation.
- Narrow and representative wider layouts, zoom and long content where relevant,
  including reachability and overflow of controls.

Automated accessibility tools can find some errors but do not establish actual
screen-reader usability, sufficient contrast in every state, touch behavior, or
visual acceptance. Reviewers should record the tool, browser, viewport, theme,
input method, and result; they should identify any checks not performed and the
person responsible for follow-up.

## Evidence and acceptance

Authors should include the exact revision, affected stories and states, commands
and results, and links to screenshots or recordings in the pull request. Visual
artifacts should use synthetic content and show the relevant state at selected
sizes and themes; they are evidence for review rather than approved baselines.
Authors should record each automated and manual check separately, including
screen-reader software and physical devices when used. Reviewers should link an
explicit decision and any unresolved findings to the revision reviewed. A code
review, green automated checks, or an unreviewed screenshot alone does not
establish visual acceptance.

The [testing guide](testing-guide.md#ui-changes) gives the existing focused
commands. Authors should update the pattern's status and evidence when the
reviewed behavior changes; they should return changed patterns to Draft until
that change receives explicit review.
