# Documentation style guide

Good documentation helps people understand what they can do and how to do it.
You can use this guide to write and review instructions that feel helpful and
make sense to someone getting to know Idea Map, including readers without a
technical background. These rules apply to both contributors and AI agents.

> For AI readers: This document contains all writing rules and context needed to
> apply this style guide. You do not need to follow its links for necessary
> context; they provide attribution and optional further reading. This statement
> applies only to this document, not to other repository documents.

These standards apply to repository documentation, README files, API comments,
review descriptions, changesets, and release notes.

Authors should use the relevant rules for each format; a method comment, for
example, needs a behavior summary rather than a document introduction. Apply the
standards when creating or editing content; an unrelated document does not need
a rewrite as part of every change.

The following contents links navigate within this guide:

- [Purpose and maintenance](#purpose-and-maintenance)
    - [Audience and purpose](#audience-and-purpose)
    - [Accuracy and ownership](#accuracy-and-ownership)
    - [Documentation authority and audiences](#documentation-authority-and-audiences)
    - [User guides](#user-guides)
        - [Decide when to add or edit a guide](#decide-when-to-add-or-edit-a-guide)
        - [Write a how-to guide](#write-a-how-to-guide)
        - [Review and maintain a guide](#review-and-maintain-a-guide)
    - [Stable instructions and work sessions](#stable-instructions-and-work-sessions)
- [Language and grammar](#language-and-grammar)
    - [Tone, inclusion, and terminology](#tone-inclusion-and-terminology)
    - [Voice, person, and tense](#voice-person-and-tense)
    - [Requirements, claims, and time](#requirements-claims-and-time)
    - [Abbreviations and new terms](#abbreviations-and-new-terms)
    - [Capitalization, agreement, and possessives](#capitalization-agreement-and-possessives)
    - [Sentences and paragraphs](#sentences-and-paragraphs)
    - [Explicit subjects in paragraphs](#explicit-subjects-in-paragraphs)
- [Document structure](#document-structure)
    - [Titles and headings](#titles-and-headings)
    - [Lists](#lists)
    - [Procedures](#procedures)
    - [Tables and notices](#tables-and-notices)
- [Markdown and references](#markdown-and-references)
    - [Source formatting and filenames](#source-formatting-and-filenames)
    - [Links and cross-references](#links-and-cross-references)
    - [Accessible images and media](#accessible-images-and-media)
- [Technical documentation](#technical-documentation)
    - [Inline code and examples](#inline-code-and-examples)
    - [Portable commands and placeholders](#portable-commands-and-placeholders)
    - [README files and comments](#readme-files-and-comments)
    - [API contracts and reference comments](#api-contracts-and-reference-comments)
    - [Phone numbers](#phone-numbers)
- [Review descriptions and release notes](#review-descriptions-and-release-notes)
- [Documentation review checklist](#documentation-review-checklist)
- [Sources and adaptations](#sources-and-adaptations)

## Purpose and maintenance

You should give readers enough context to complete their task without assuming
unstated knowledge. Keep the documentation focused on their goal. Maintainers
should update it alongside the implementation it describes.

### Audience and purpose

You should identify the intended readers and the outcome they can achieve in the
opening paragraph. Use natural wording rather than a mandatory opening sentence.
Lead with what readers can do or understand, rather than a catalog of the
document's contents.

- Address the reader directly when it sounds natural, and connect the subject
  to a concrete task or question.
- Keep governance, approval mechanics, and document ownership in the relevant
  sections rather than making them the reader's first introduction.
- Explain unfamiliar concepts, prerequisites, and terms where readers need them.
- Add section introductions when they provide useful context; omit introductions
  that merely repeat the heading.
- Recommend a supported path through a task instead of making beginners choose
  among unexplained alternatives.
- Separate essential instructions from advanced options, reference details, and
  background explanations.
- Write for humans even when an AI agent is the immediate reader.

You can introduce a task with reader-focused wording such as:

> You can run Idea Map on your own computer using local services and synthetic
> data, with no production credentials. This guide walks you through setting up
> your first checkout, starting the app, and stopping services when you're done.

### Accuracy and ownership

Documentation is part of the change it describes. You should update affected
instructions, examples, comments, and references in the same change as the
implementation.

- Describe the intended system in the present tense as the project standard,
  without separating implemented behavior from work that remains.
- Keep a small, useful set of maintained documents; remove or correct obsolete,
  inaccurate, or redundant material.
- Give each procedure or rule one canonical home and link to it from other
  documents.
- Provide short definitions and necessary context in place rather than sending
  readers elsewhere for every unfamiliar term.
- Keep historical evidence within the migration directory; maintain operating
  instructions and authoritative requirements in their subject guides.
- Link from the repository to documentation maintained elsewhere so readers can
  discover its canonical location.
- Accept focused improvements without requiring unrelated cleanup, and make
  review feedback specific and actionable.

The self-contained rules in this guide are a deliberate exception to avoiding
duplication of third-party guidance. Source links document provenance; they do
not send readers elsewhere for additional writing requirements.

### Documentation authority and audiences

Documentation defines Idea Map's intended behavior and architecture as the
project standard. Contributors propose changes through pull requests; merging a
pull request into `main` accepts its documented decisions. You should bring the
application into compliance with that standard.

You should describe the intended system in the present tense, assuming it
behaves as documented. Omit proposal labels, implementation-progress framing,
separate current/target diagrams, and descriptions of temporary scaffolding.
Keep genuine unresolved decisions and externally unverified facts explicit
without inventing answers.

The `docs/v1-migration/` directory is the sole exception to this present-tense
rule. Its README defines its historical vocabulary and scope; its contents do
not describe current behavior or establish current requirements. You should
confine project-generation terminology to that directory, except literal links
and unrelated third-party version identifiers.

You should give each directory the following responsibility:

| Directory | Audience and contents |
| --- | --- |
| `contributor-guides/` | Contributors developing, testing, documenting, or using AI tools |
| `user-guides/` | Nontechnical users completing actions through the application |
| `architecture/` | Contributors understanding platforms, integrations, configuration, and boundaries |
| `design/` | Contributors maintaining visual language, component contracts, and accessibility |
| `policies/` | Readers applying authoritative rules and operational procedures |
| Migration directory | Readers investigating historical evidence and migration context |

You should name policy files `*-policy.md` for decisions and rules, or
`*-procedure.md` for linear processes. Omit prices, cost estimates, budgets,
commercial-plan comparisons, financial thresholds, and billing discussions from
repository documentation; retain technical resource limits and constraints.

### User guides

User guides explain one coherent action to nontechnical readers. You should name
every Markdown file in `user-guides/` as `how-to-<user-action>.md`, with a
descriptive lowercase kebab-case action after `how-to-`.

#### Decide when to add or edit a guide

You should include user-guide changes in the same pull request as the feature
or workflow they explain:

- Add a guide when someone can complete a distinct user task that has no guide
  yet, using an action-based name such as `how-to-reset-your-password.md`.
- Edit the existing guide when the goal stays the same but steps, controls,
  prerequisites, permissions, expected results, or recovery options change.
- Search for an existing guide before adding another, and keep related paths
  in one guide when they lead to the same outcome.
- Split a guide when it covers separate user goals, and combine guides that
  duplicate the same task.

Internal refactoring and developer-tool changes do not need a new user guide
unless they change what users do or experience. You should describe a workflow
only when its interactions are known, rather than inventing screens or steps to
fill the directory. Write the instructions as the intended experience, without
proposal labels or implementation-progress notes.

#### Write a how-to guide

You should write user guides with these boundaries:

- Open with the task and the outcome readers can achieve, using a title such
  as "Reset your password" that matches the filename's action.
- Explain user-facing prerequisites, steps, expected results, and relevant
  recovery options, including the account or permissions the user needs.
- Put actions in sequential numbered steps, with one main action per step and
  no more than two sentences per item.
- Use the visible or accessible names of interface controls in bold, and keep
  the wording consistent with what people see in the application.
- Explain the effect of actions on privacy or stored information before the
  relevant step, especially when an action cannot be undone.
- Mark optional steps and describe what success looks like and how readers can
  recover from a failed step without guessing.
- Use fictional examples and remove private information from screenshots.
  Include alternative text and explain important visual information in prose.
- Exclude developer setup, commands, source paths, infrastructure details, and
  explanations of underlying architecture.

#### Review and maintain a guide

Before handing off a guide, you should check it from the reader's starting point:

1. Compare the steps and labels with the relevant interface and expected results,
    using synthetic data for a walkthrough or reviewing a recorded walkthrough
    when the workflow changes.
2. Check that readers can finish the task without developer knowledge, and remove
    redundant background or steps that belong to a different task.
3. Update the guide's link in `docs/README.md` when adding or renaming it, and
    repair links and heading anchors affected by moves, merges, or removals.
4. Follow the documentation review checklist for rendered Markdown, links,
    accessibility, tone, explicit subjects, and modal verbs. Wording-only edits
    need no application build or running services.

An empty user-guide directory contains only `.gitkeep`. The documentation index
and this style guide define its purpose without adding a README that violates
the action-based filename convention. You should remove `.gitkeep` when adding
the first guide and restore it if the directory becomes empty.

### Stable instructions and work sessions

You should use instructions that remain useful after merging. Avoid pull request
numbers, branch-specific commands, agent-specific container names, personal
paths, and temporary checkout names in reusable procedures.

For documents that explain running tools or services, you should distinguish
these stages:

| Stage | Information authors should include |
| --- | --- |
| One-time setup | Authors should explain tool and dependency installation, persistent configuration such as `.env`, prerequisites, and safe example values. |
| Start of each work session | Authors should describe service startup, readiness checks, recurring commands, and success indicators. |
| End of each work session | Authors should explain shutdown, released ports, which checkout's services stop, and which data persists or is lost. |

You should say explicitly when a lifecycle stage requires no action. Include
shutdown instructions when startup instructions create services that continue
running.

You should use stable repository commands to handle checkout-specific details.
Define or reuse named commands in `package.json`, called *package scripts*, for
repeated operations, especially service startup and shutdown. Use the
repository's package manager in examples, and keep required flags, service
names, and project-name handling inside those scripts.

## Language and grammar

You should use American English and familiar, precise words. Prefer direct
explanations that work for readers with different backgrounds and levels of
English fluency.

### Tone, inclusion, and terminology

You should write in a warm, conversational, and respectful tone, as a helpful
colleague would. Keep the language precise without slang, jokes, hype, or
unnecessary formality. Give concrete instructions rather than describing a task
as easy, obvious, simple, or quick.

- Speak to people rather than describing them as abstract roles when "you"
  makes the meaning clearer; name roles when responsibilities differ.
- Use natural contractions such as "you'll" and "it's" when they fit the
  context, while keeping requirements and consequences explicit.
- Prefer concrete actions and familiar words to administrative phrases such as
  "establishes its decisions" or repeated openings like "This document defines."
- Let warmth come from useful context and considerate wording, without forced
  greetings, exaggerated enthusiasm, or claims that a task is easy.
- Read introductions aloud and revise wording that sounds like an internal
  classification rather than help for a person.
- Avoid idioms, metaphors, cultural references, and jargon when plain language
  conveys the meaning.
- Define necessary technical terms on first use and use them consistently.
- Use inclusive terms such as *allowlist*, *replica*, and *person-hours* where
  those terms accurately describe the concept.
- Preserve literal identifiers and keywords in code font, even when the existing
  code uses a term to avoid in prose.
- If a legacy term is necessary for recognition, explain its connection to the
  preferred term once and use the preferred term afterward.
- Use gender-neutral language and singular *they* when a person's gender is
  unknown or irrelevant.
- Respect how people and communities identify themselves, such as a preference
  for "a person with a disability" or "a disabled person."
- Avoid ableist descriptions, stereotypes, and language that treats people
  without disabilities as the default or normal group.
- Use diverse, fictional people and locations in examples without relying on
  stereotypes or irrelevant personal characteristics.

You should describe software behavior without attributing human thoughts,
desires, or feelings to it. For example, write "The server rejects an invalid
token" rather than "The server dislikes the token."

### Voice, person, and tense

You should make the actor clear and explicitly establish the subject of
requirements and instructions in each standalone paragraph. Use active voice by
default and second person when addressing the reader. Omit a repeated subject
only after establishing it in the same paragraph or, for a shared-subject list,
in the immediately preceding introduction.

- Use third person for actions performed by software or by someone other than
  the reader.
- Use first-person plural only when it clearly refers to the organization or
  maintainers, rather than combining the author and reader into an ambiguous
  *we*.
- Use passive voice when the actor is irrelevant or the result deserves focus,
  as long as readers can tell who is responsible.
- Describe general behavior in present tense; reserve future tense for an action
  that happens later, such as the next scheduled backup.
- Write method summaries in third-person present tense with an explicit subject,
  such as "The `getRevision` method returns the approved revision."

### Requirements, claims, and time

You should choose modal verbs by the subject and the kind of consequence
involved. The following local meanings apply throughout this guide and override
differing advice in the source guides:

| Modal verb | Meaning and usage |
| --- | --- |
| *Must* / *must not* | A requirement with an intrinsic consequence: noncompliance itself prevents the task from working or violates a technical constraint. Authors should always use *must* or *must not* for requirements whose subject is a machine or automated system. |
| *Should* / *should not* | A requirement for a human subject whose consequences are discretionary, such as a maintainer deciding whether to reject a contribution. It remains a requirement rather than merely a suggested option. |
| *Can* / *could* | Capability, permission, or a feature or action that is possible, without adding a probability judgment. |
| *Might* / *may* | The capability, permission, or possibility expressed by *can* / *could*, with added uncertainty or probability. |
| *Will* | An event or action that genuinely happens later in time, never a substitute for present-tense behavior. |

A local machine must have project dependencies installed before running commands
that depend on them; otherwise, those commands fail because dependencies are
missing.

Human contributors should write in a conversational, respectful tone. A
maintainer can decide whether a tone violation warrants rejecting a pull
request. You should also use *must* for human requirements with intrinsic
consequences, rather than discretionary enforcement.

**For AI readers:** Coding agents are automated systems and must follow the
rules for machines. Agents must interpret human-directed *should* as *must* and
*should not* as *must not* when applying these rules to their own work.
Discretionary enforcement for human contributors does not make compliance
optional for coding agents.

You should distinguish requirements from statements of fact; the machine-subject
rule applies to requirements, not factual descriptions. Use "The validator must
reject an invalid token" for a machine requirement and "The validator rejects an
invalid token" for a factual description of the intended system. For uncertain
outcomes, use wording such as "The request might time out." For a genuinely
later event, use wording such as "The backup service will archive this file when
the next scheduled backup runs."

You should support performance, security, and comparison claims with verifiable
evidence and relevant conditions. Avoid superlatives, subjective comparisons,
and absolute guarantees that an incident or product change could invalidate.

In maintained product instructions, you should describe behavior without
relative labels such as *new*, *currently*, *latest*, or *soon*. Use an explicit
date or version when time is relevant. Historical migration evidence is confined
to the migration directory. Release announcements can describe actual changes
over time with explicit release context.

### Abbreviations and new terms

You should use abbreviations only when they help readers. On first use, spell
out an unfamiliar term and put its abbreviation in parentheses; italicize both
when introducing the term, for example, *continuous integration (CI)*.

- Use the abbreviation alone afterward, repeating the explanation when distant
  sections can be read independently.
- If a term appears only once, prefer its full form unless the abbreviation is
  necessary for recognition.
- Define a non-exempt abbreviation used in a heading in the first paragraph that
  follows.
- Preserve established capitalization, but do not capitalize the expanded words
  merely because the abbreviation uses capitals.
- Omit periods in initialisms (abbreviations spoken letter by letter), and
  replace internet shorthand and Latin abbreviations with plain words such as
  *for example* and *that is*.
- Do not turn abbreviations into verbs; write "Connect using *Secure Shell
    (SSH)*"
  rather than "SSH into the server."

You can use the following common abbreviations without spelling them out on
first use, including in headings, because they are ubiquitous among this guide's
target audience:

- AI: artificial intelligence
- API: application programming interface
- CSS: Cascading Style Sheets
- HTML: Hypertext Markup Language
- HTTP: Hypertext Transfer Protocol
- JSON: JavaScript Object Notation
- SQL: Structured Query Language
- URL: uniform resource locator

You should italicize an unfamiliar term when defining it and a word being
discussed as a word. Use code font for literal code instead of italics or
quotation marks. Retain articles such as *a*, *an*, and *the*, including in
headings. Choose *a* or *an* by pronunciation, not by the first written letter.

### Capitalization, agreement, and possessives

You should use sentence case for headings, captions, table headings, and list
items. Preserve the exact capitalization of product names and code identifiers;
avoid unnecessary capitals or all-uppercase emphasis.

- Start text after a colon with lowercase unless it begins a heading, quotation,
  proper noun, or a labeled notice such as "Warning: Keep a backup."
- Match verbs and pronouns to the actual subject, including in sentences with
  long phrases or multiple subjects.
- Form ordinary plurals without an apostrophe, including *APIs*.
- Add *es* to abbreviations ending in *s*, *sh*, *ch*, or *x*, such as *OSes*.
- Match expanded terms and abbreviations in number, such as *virtual machines
  (VMs)*.
- Use a plural after *one or more*, a singular after *more than one*, and avoid
  optional endings such as "file(s)."
- Keep unit abbreviations singular after numbers, such as "64 GB," with a space
  between the number and unit.
- Form singular possessives with an apostrophe and *s*, and plural possessives
  ending in *s* with an apostrophe alone.
- Avoid awkward possessives of product names or code; write "the method's return
  value" or "the value returned by `getRevision`."
- Do not change an identifier to make it plural or possessive; write "`Revision`
  objects" rather than "`Revisions`."

### Sentences and paragraphs

You should put the important point first and keep each paragraph about one idea.
Use short sentences and paragraphs without imposing a rigid word or sentence
count on ordinary prose.

- State a condition, location, or goal before the instruction it qualifies.
- Make pronoun references unambiguous; use "this value" rather than an unclear
  "this" or "it."
- Add *that* or *which* when needed for clarity, using *that* for restrictive
  clauses and *which*, with commas, for additional information.
- Prefer direct statements over double negatives and exceptions to exceptions.
- Vary sentence openings and remove filler, unnecessary repetition, and routine
  "please" from instructions.
- Use serial commas and parallel grammatical structures for comparable ideas.

You should keep short examples close to the idea they illustrate, using *such
as* or *for example*. Use a separate sentence or code block for a longer example
rather than interrupting a sentence with a lengthy aside.

### Explicit subjects in paragraphs

You should explicitly identify the subject of requirements and imperative
instructions in every standalone paragraph. You should name the document,
person, role, or component involved in the first requirement or imperative; a
heading or an earlier paragraph does not establish the subject for a new
paragraph. Later imperatives in the same paragraph can imply that subject while
it remains unchanged. When the subject changes, you should name the new
subject in the first requirement or imperative about it.

The following example identifies authors first, then explicitly names
maintainers when the paragraph switches to their responsibilities:

> Documentation authors should give readers enough context to complete their task
> without assuming unstated knowledge. Keep the documentation focused on their
> goal. Maintainers should update it alongside the implementation it describes.

You should follow this rule without repeating the subject in every sentence. For
lists, establish a shared subject in the immediately preceding paragraph or
sentence, or name varying subjects in every item. Use natural wording, and
distinguish requirements about a document's qualities from instructions directed
to its authors or maintainers.

## Document structure

You should organize information around reader tasks and questions. Use headings,
lists, and tables that help readers scan the source and find the right section
in the rendered page.

### Titles and headings

You should use one descriptive level-one heading for the document title. Start
sections at level two and nest them without skipping levels.

- Use sentence case and meaningful, distinctive headings that produce useful
  navigation anchors.
- Start task headings with a base-form verb, such as "Start local services," and
  use noun phrases for concepts, such as "Service lifecycle."
- Avoid starting headings with an *-ing* verb when a clearer task or concept
  heading is available.
- Mark optional sections with an "Optional:" prefix.
- Avoid numbering headings, links in headings, unnecessary punctuation, and a
  final period.
- Use code in a heading only when needed, with a descriptive noun identifying
  the code element.
- Follow headings with relevant content; do not use empty headings or substitute
  bold paragraphs for heading structure.

You should introduce groups of subsections as "the following sections" when
orientation is useful. Do not add a repetitive audience sentence to every nested
section.

### Lists

You should use numbered lists for sequences, priorities, and procedures; use
bullets for unordered collections. Use a definition list or a compact
term-and-description list for explanations of several terms.

You should omit the subject in list items when the immediately preceding
paragraph or sentence explicitly identifies the same subject for every item. The
introductory requirement's modal meaning applies to each item, including coding
agents' translation of *should* to *must*.

You should rewrite the preceding paragraph or add a new introductory paragraph
or sentence when a list shares a different subject. Establish that shared
subject immediately before the list rather than relying on a heading or an
earlier paragraph.

You should explicitly identify the subject in every item when a list's items
have varying subjects, regardless of the subject named in the introduction.
Apply the following writing rules to lists:

- Prefer one sentence per item and never exceed two sentences in a numbered or
  bulleted item.
- Move longer explanations into surrounding paragraphs, separate subsections, or
  a table when the information is genuinely tabular.
- Introduce lists with a complete sentence when context is needed, rather than a
  sentence fragment completed by the items.
- Keep items grammatically parallel and state whether all items or only one
  option is required.
- Start items with capitals unless literal case matters, and end complete
  sentences with punctuation.
- Omit final punctuation for bare terms, code, links, or document titles, and
  keep punctuation consistent within each list.
- Avoid a list containing a single item, except when presenting a single-step
  procedure that benefits from being set apart.
- Prefer flat lists except where hierarchy helps readers, including the required
  nesting of subheadings in tables of contents.

For a run-in description, you should use a consistent form such as "**Scope:**
the affected package" or "**Scope.** This change affects the renderer package."
Avoid using a dash in place of the colon or period. Introduce examples as
examples instead of ending lists with *etc.* or *and so on*.

The following example lists responsibilities with different subjects, so each
item identifies its subject:

- Authors should explain the document's audience and intended outcome.
- Reviewers should verify commands and links before approving documentation.

### Procedures

You should explain prerequisites, the working directory or tool, permissions,
required inputs, and consequences before readers begin. Use numbered steps in
the order readers perform them, with one main action per step.

- Start each step with an imperative, adding its location or condition first
  when relevant.
- Describe what the action achieves rather than introducing commands only with
  "Run the following command."
- Put a goal before the action, and put a result or justification after it.
- Explain how to recognize success and what to do if an expected result does not
  appear.
- Mark optional steps with "Optional:" and explain the condition for any
  alternative path.
- Recommend the shortest accessible supported procedure, and separate necessary
  alternatives under descriptive headings.
- Reference repeated procedures at their canonical location instead of copying
  them into several documents.
- Refer to interface controls by their visible or accessible labels, not by
  color, shape, or position alone.
- Include essential key presses, such as Enter to submit or Ctrl+C to stop a
  running process, without adding optional keyboard shortcuts to every action.

A step can introduce a fenced command or show output without adding long prose
inside the item. If an explanation needs more than two sentences, you should
split the task into short procedures and put the explanation between them. Apply
the limit to the whole item, including any nested prose paragraphs; code and
output are not prose sentences.

For a single action, a normal sentence is usually enough. When multiple sections
contain independent procedures, you should restate the tool or environment so
readers can start at either section.

### Tables and notices

You should use tables for comparisons or records with several related
attributes. Prefer a list for a one-dimensional collection and a description
list for simple term-definition pairs unless a table makes comparison easier.

- Introduce each table with a complete sentence explaining its purpose.
- Use concise sentence-case column headings without final punctuation, logical
  row order, and short cells.
- Avoid merged cells, tables used for page layout, code samples inside tables,
  and tables in the middle of procedures.
- Split wide or complicated tables so they remain usable on small screens, and
  do not communicate meaning through symbols or color alone.
- In HTML documentation, mark header cells semantically and associate them with
  their rows or columns; use captions when multiple nearby tables need labels.

You should keep essential information in the main flow. Use notices sparingly,
avoid stacking them, and place a risk notice before the action that creates the
risk. In repository Markdown, use a blockquote with a bold textual label, such
as `> **Warning:** This command permanently deletes the selected records.`

The following notice labels distinguish their purposes:

| Label | Purpose |
| --- | --- |
| Note | An optional tip or aside that readers can skip and still complete the task. |
| Caution | A risk that requires attention before proceeding. |
| Warning | A significant security or irreversible data-loss risk. |
| Success | Feedback for a completed action in interactive content, rather than a claim on a static documentation page. |

You should not hide prerequisites, required steps, expected results, or routine
cross-references in notes.

## Markdown and references

You should prefer portable Markdown that remains readable as plain text. Avoid
custom HTML and renderer-specific features when ordinary Markdown conveys the
information.

### Source formatting and filenames

You should use `#`-style headings with a space after the markers. Leave blank
lines around headings, paragraphs, lists, tables, and fenced code blocks.

- Aim for roughly 80 columns in prose; allow longer links, headings, table rows,
  and code where wrapping reduces clarity or correctness.
- Do not use trailing whitespace or forced rendered line breaks within prose;
  wrap source so the rendered paragraph can reflow.
- Write procedure numbers sequentially in source rather than repeating `1.`.
- Use a consistent bullet marker and four-space indentation for nested lists and
  fenced blocks within list items, preserving list membership when rendered.
- Use fenced code blocks with a language identifier, or `text` for plain output,
  rather than indentation-only code blocks.
- Place a table of contents after a long document's introduction and before its
  main sections. Include links to every section and subheading, nesting
  subheading link lists with four-space indentation per heading level.
- Use descriptive lowercase names separated by hyphens for new documentation
  files, with unaccented English letters and digits rather than spaces or accented letters.
- Preserve conventional names such as `README.md` and existing or generated
  filenames that tools require.

You should name file types in prose, such as "Markdown file" or "*Portable
Network Graphics (PNG)* file," rather than using extensions as generic names.
Refer to a specific file using its exact spelling and code font, with the word
*file* when needed to clarify its role.

### Links and cross-references

You should give readers the essential context before offering a link. Use the
destination title or a short descriptive phrase that makes sense on its own,
rather than "click here," "this document," or a bare URL.

- Use relative paths for repository files, including `../` when needed, and
  heading fragments for specific sections.
- Prefer the most relevant page or heading over a site's home page, and use
  secure HTTP (HTTPS) when available.
- Avoid duplicate links unless a long document or independent entry point makes
  the repetition useful.
- Use inline links for short destinations and reference links when long or
  repeated URLs interfere with source readability.
- Put reference definitions near the end of their first section, or at the end
  of the document when several sections share them.
- Preserve the capitalization of external titles and include both an expanded
  term and its abbreviation in link text when introducing them together.
- Use "For more information about ..., see ..." for a separate cross-reference
  sentence when the link's purpose needs explanation.
- Identify downloads, email links, and same-page section jumps when their
  behavior might be unexpected.
- Let readers choose whether to open a new tab; identify the behavior if a
  publishing platform requires a new tab.

You should use *preceding*, *following*, or a named section rather than *above*,
*below*, or *on the right*. Avoid putting several links directly beside one
another without separating text or punctuation.

### Accessible images and media

You should use an image when it explains something more clearly than text alone,
and provide equivalent essential information in prose. Do not substitute
screenshots for copyable code, text, or terminal output.

- Give informative images useful alternative text describing their purpose, and
  use empty alternative text for purely decorative images.
- Prefer scalable diagrams when practical, and keep labels readable when the
  image is enlarged.
- Identify controls by their labels, and explain information conveyed through
  color or other visual cues in text as well.
- Provide captions or transcripts for audio and video, and avoid flashing or
  distracting animation.
- Keep content readable without images, color, sound, or a mouse.

## Technical documentation

You should ensure examples match the implementation and explain the context
needed to use them. Keep examples synthetic and exclude credentials, private
data, and production records from documentation, output, logs, and review
descriptions.

### Inline code and examples

You should use code font for identifiers, commands, options, paths, environment
variables, literal input and output, data types, and protocol values. Use
ordinary font for product names and prose concepts, and descriptive links for
browser destinations.

- Preserve exact identifier spelling and add a descriptive noun when grammar
  requires one, such as "the `getRevision` method."
- Format literal Boolean values such as `true` as code, but use ordinary text
  when describing whether a condition is true.
- Call HTTP results *status codes*, such as `404 Not Found` or the `2xx` range.
- Use bold for interface labels; combine bold and code formatting when the
  displayed label is itself a literal identifier.
- Link an API element to its reference on its first useful mention in a section,
  rather than linking every occurrence.
- Introduce a sample with its purpose and follow the repository's conventions
  for the language, including indentation.
- Keep code lines near 80 columns where possible without breaking valid syntax.
- Put omissions in language-appropriate comments and label incomplete examples
  as excerpts rather than runnable samples.

You should not add quotation marks around literal code unless they belong to the
input. Preserve required string delimiters, such as quotation marks, inside code
samples.

### Portable commands and placeholders

You should prefer persistent `.env` configuration to shell-specific assignments,
provide safe example values, and verify that the tool loads the documented file.
Prefer package scripts, `git`, and `docker` to shell builtins. When a
shell-specific command is necessary, provide equivalent PowerShell and Bash
versions.

For example, from the repository root after development setup, contributors can
check which local services are running:

```sh
pnpm dev:status
```

This package command works in PowerShell and Bash. It prints the Compose project
name and lists that checkout's containers, including stopped containers. You can
read the status column to distinguish running services from stopped ones.

You should follow these rules when documenting commands:

- Keep runnable commands free of prompt symbols, directory prefixes, optional
  syntax notation, and illustrative ellipses.
- Prefer a single line or a package script; when splitting commands, use the
  correct continuation syntax for the named shell.
- Use a backslash for Bash continuation and a backtick for PowerShell
  continuation, never a Windows Command Prompt caret in a PowerShell example.
- Include the arguments needed for the recommended path, and separate optional
  variations rather than putting several choices in one copyable command.
- Use descriptive uppercase placeholders separated by underscores, such as
  `PACKAGE_NAME`, unless the syntax requires another convention.
- Explain every placeholder on first use, including its source, valid values,
  and required delimiters or quotation marks.
- For multiple placeholders, list their explanations in order of appearance
  immediately after the command, using "Replace the following:" as the lead-in.
- Separate command input from output, and show output only when it helps readers
  verify success or retrieve a needed value.
- Introduce variable output as "The output is similar to the following," and
  explain placeholders used in output as values rather than replacement inputs.

Inline placeholders can use italic code, such as *`PACKAGE_NAME`*. Inside code
fences, you should use plain placeholder names without Markdown styling.

In a clearly labeled syntax reference, you should use `[ARGUMENT]` for an
optional argument, `{A|B}` for an exclusive choice, and `ARGUMENT ...` for
repetition. Explain the notation, and provide a separate runnable example. To
omit lines from sample output, use `...` on its own line; do not use that
convention as executable code.

### README files and comments

A `README.md` file orients readers to the repository or package directory that
contains it. You should keep the root and public-interface package README files
current, and link to detailed guides rather than copying them.

- Explain what the directory or package contains and what it is used for.
- Identify the maintenance contact or support route and relevant release,
  private-package, experimental, or deprecation status.
- Show the simplest supported usage and explain how to find setup, tests,
  debugging information, and release guidance.
- Put README files with the code they introduce, rather than moving their
  content into an unrelated documentation directory.

You should choose meaningful code names before adding comments that restate
them. Use inline comments for rationale and non-obvious constraints; use API
comments for behavior and the contract callers depend on. Add meaningful tests
for documented behavior when implementing or changing that behavior.

### API contracts and reference comments

You should document public classes, interfaces, types, constants, fields,
functions, and methods. Use the language's existing documentation format and a
concise first sentence that remains useful when extracted into a reference
summary.

- Describe a type's purpose with an explicit subject, such as "The `Revision`
  type represents an idea revision," and add a short usage example when helpful.
- Start method descriptions with the named method and its present-tense action,
  such as "The `getRevision` method returns the approved revision."
- Explain parameters, allowed values, defaults, return values, exceptions,
  prerequisites, and behavior when a dependency is unavailable.
- For Boolean parameters, explain both states; for Boolean results, state the
  condition for true and what false means.
- Keep parameter and return descriptions concise, capitalized, and punctuated,
  and move shared context into the type or method description.
- Explain callback invocation and who implements the callback when relevant.
- Identify deprecated APIs, the deprecation version when applicable, their
  replacement, and the steps callers need to migrate.

For web endpoints, you should document the schemas (accepted structure and
values) of route, query, and body inputs, plus error and retry behavior. Explain
authorization requirements and public/private data boundaries without exposing
secrets or private examples.

For paginated results, which divide a result set into pages, you should state
defaults, maximum page sizes, and behavior when data changes. Explain how the
cursor identifies the next page and when it expires or becomes invalid.

For idempotent operations, where retry handlers must not repeat side effects,
you should document how long retry records remain, requests still in progress,
and recovery. If the implementation uses a transactional outbox (an event record
saved atomically with a data change), explain how it interacts with retry
handling.

### Phone numbers

You should use fictional example numbers in the reserved range `800-555-0100`
through `800-555-0199`, rather than a real person's number. For prose, separate
North American number groups with hyphens, include the `+` country code for
international numbers, and write extensions as "extension 123."

You should use nonbreaking hyphens when a rendered prose number needs to stay on
one line. Follow the required literal format inside code or an API field instead
of inserting typographic characters that could break the example.

## Review descriptions and release notes

You should give reviewers and readers the concrete result, its reason, and the
evidence needed to assess it. Explain the concrete change and evidence without
labeling project guidance as awaiting acceptance elsewhere.

- Explain what changed and why, link the issue, and identify the affected app or
  package when that context helps.
- Record checks actually run and their results, skipped checks and reasons,
  validation gaps, and setup needed to reproduce the results.
- Include screenshots when appearance changes and visual evidence when it helps
  explain the result.
- Never claim an unrun check passed or include secrets, credentials, or private
  data in a review description or changeset.
- Write changesets and changelogs around the behavior users receive, rather than
  planned work or internal task identifiers.
- Identify breaking changes explicitly, including for `0.x` versions, and record
  migration instructions and required app/package version combinations.
- In application release notes, include the immutable reviewed commit or image,
  affected package versions, behavior, migration notes, and validation.
- For migrations and destructive operations, document compatibility, prior
  versions, recovery ownership, and backup or rollback instructions.

You should update release history accurately rather than silently rewriting it.
The release workflow determines when a changeset is required and who can
version, publish, or deploy; writing documentation does not authorize those
operations.

## Documentation review checklist

For documentation-only changes, you should review the content, links, and
commands; an unrelated application build is unnecessary. A prose-only edit needs
no tool setup, running application, or services. If examples or behavior also
change, run the relevant checks for that change and report their actual results.

Before handing off documentation, reviewers should complete this review:

1. Confirm the audience, purpose, prerequisites, and recommended path are clear
    without repetitive introductions or hidden setup assumptions. Check that the
    opening speaks to readers' goals in a warm, natural voice.
2. Check intended behavior against documented decisions, and verify commands,
    configuration loading, identifiers, and examples against repository scripts.
3. Check setup, session-start, and shutdown instructions, including checkout
    scope, freed ports, preserved data, and stages requiring no action.
4. Check every numbered and bulleted item for parallel structure, appropriate
    punctuation, and the two-sentence maximum. Confirm that shared subjects are
    established immediately before lists and omitted from items, while varying
    subjects are explicit in every item.
5. Review language for clarity, inclusion, accurate claims, and explicit
    distinctions between intrinsic and discretionary requirements, capability,
    probability, and genuinely later events. Check that each standalone
    paragraph names the subject of requirements and imperatives, and explicitly
    names any new subject when responsibilities change.
6. Check heading hierarchy, contents links, relative paths, fragments, source
    attribution, and consistency with related procedures. Confirm that the table
    of contents includes every subheading in a matching nested link list.
7. Review rendered Markdown for intact lists, fenced code, readable tables,
    alternative text, and information available without visual cues.
8. Review the complete diff, check whitespace with `git diff --check`, and
    record the verification performed and any remaining limitations.

## Sources and adaptations

You can use the source index to see how the 40 references informed these rules.
The rules have been combined, paraphrased, and adapted for Idea Map; linked
pages do not impose additional requirements.

Google Style Guides' documentation guides are licensed under
[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/),
as recorded in the
[Google Style Guides license](https://github.com/google/styleguide/blob/gh-pages/LICENSE).
The Google developer documentation style guide credits its content under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
and its code samples under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The examples
here use project-specific wording and commands.

You should follow these local choices, which resolve differences between the
sources and the repository's requirements:

- Use natural audience-and-purpose introductions instead of the former exact
  document and section opening templates.
- Name the subject of requirements and imperatives in every standalone
  paragraph, including reference summaries, and name new subjects when
  responsibilities change. Let list items inherit a shared subject only from an
  explicit introduction, and name varying subjects in every item.
- Use the local modal meanings for intrinsic requirements, human requirements
  with discretionary consequences, and coding agents' interpretation of rules.
- Retain the two-sentence maximum for list items, including procedural steps,
  rather than allowing unrestricted paragraphs within them.
- Use fenced, language-tagged code rather than indentation-only samples.
- Use sequential procedure numbering and GitHub-compatible contents links rather
  than repeated source numbers or Gitiles `[TOC]` directives.
- Use relative repository paths, including parent-directory paths, rather than
  site-root URLs that depend on a publishing platform.
- Prefer commands without prompt symbols and use PowerShell/Bash syntax instead
  of assuming Bash or Windows Command Prompt.
- Retain essential key presses and document both shells when portability
  requires alternatives to a single procedure.
- Use approximate source line lengths without forcing rendered line breaks, and
  preserve repository conventions for code indentation and required filenames.
- Keep adopted writing rules self-contained here while linking to canonical
  procedures from other documents to avoid duplicating operational instructions.

This table shows the original references and where their guidance appears here:

| Reference | Coverage in this guide |
| --- | --- |
| [Markdown style guide](https://google.github.io/styleguide/docguide/style.html) | Source formatting, headings, lists, code fences, links, images, and tables |
| [Documentation best practices](https://google.github.io/styleguide/docguide/best_practices.html) | Accuracy, ownership, canonical guidance, comments, and incremental maintenance |
| [READMEs](https://google.github.io/styleguide/docguide/READMEs.html) | README location, purpose, contacts, status, usage, and navigation |
| [Philosophy](https://google.github.io/styleguide/docguide/philosophy.html) | Focused documentation, readable source, portability, and incremental improvement |
| [Accessibility: ease of reading](https://developers.google.com/style/accessibility#ease-of-reading) | Short prose, definitions, parallel structure, and important information first |
| [Accessibility: headings and titles](https://developers.google.com/style/accessibility#headings-and-titles) | Semantic heading hierarchy, navigation, and descriptive titles |
| [Avoid excessive claims](https://developers.google.com/style/excessive-claims) | Verifiable claims and qualified performance and security statements |
| [Inclusive documentation](https://developers.google.com/style/inclusive-documentation) | Inclusive terminology, literal legacy identifiers, and diverse examples |
| [Jargon](https://developers.google.com/style/jargon) | Plain language, necessary terminology, and definitions |
| [Prescriptive documentation](https://developers.google.com/style/prescriptive-documentation) | Recommended paths and precise obligations, options, and outcomes |
| [Timeless documentation](https://developers.google.com/style/timeless-documentation) | Stable descriptions and explicit dates or versions when relevant |
| [Voice and tone](https://developers.google.com/style/tone) | Conversational, respectful language without hype or needless politeness |
| [Abbreviations](https://developers.google.com/style/abbreviations) | Introductions, capitalization, punctuation, and avoiding shorthand |
| [Active voice](https://developers.google.com/style/voice) | Clear actors and justified passive-voice exceptions |
| [Anthropomorphism](https://developers.google.com/style/anthropomorphism) | Precise descriptions of software behavior |
| [Articles](https://developers.google.com/style/articles) | Retaining articles and choosing them by pronunciation |
| [Capitalization](https://developers.google.com/style/capitalization) | Sentence case, product names, identifiers, and text after colons |
| [Pluralization](https://developers.google.com/style/pluralization) | Agreement, abbreviations, units, identifiers, and optional plurals |
| [Possessives](https://developers.google.com/style/possessives) | Possessive forms and treatment of code and product names |
| [Tense](https://developers.google.com/style/tense) | Present behavior and genuinely deferred actions |
| [Pronouns](https://developers.google.com/style/pronouns) | Clear antecedents, relative pronouns, and singular they |
| [Second person and first person](https://developers.google.com/style/person) | Addressing the reader and distinguishing other actors |
| [Sentence structure](https://developers.google.com/style/sentence-structure) | Conditions and goals before instructions |
| [Verbs in reference documentation](https://developers.google.com/style/reference-verbs) | Present-tense method behavior summaries |
| [Examples in sentences](https://developers.google.com/style/format-examples) | Short inline examples and separate longer examples |
| [Headings and titles](https://developers.google.com/style/headings) | Task and concept headings, optional sections, and hierarchy |
| [Italics for terms](https://developers.google.com/style/italics-terms) | Defined terms and words discussed as words |
| [Lists](https://developers.google.com/style/lists) | List choice, introductions, parallel items, and punctuation |
| [Notices](https://developers.google.com/style/notices) | Notice labels, placement, and keeping required content in flow |
| [Paragraph structure](https://developers.google.com/style/paragraph-structure) | One idea per paragraph and key information first |
| [Phone numbers](https://developers.google.com/style/phone-numbers) | Fictional numbers, country codes, extensions, and prose formatting |
| [Procedures](https://developers.google.com/style/procedures) | Ordered actions, context, goals, results, and optional steps |
| [Tables](https://developers.google.com/style/tables) | Tabular content, introductions, headings, and accessible presentation |
| [Cross-references](https://developers.google.com/style/cross-references) | Selective links, meaningful text, local context, and unexpected behavior |
| [Command-line syntax](https://developers.google.com/style/code-syntax) | Runnable commands, syntax notation, output, and shell-specific continuation |
| [API reference comments](https://developers.google.com/style/api-reference-comments) | Public API coverage, summaries, parameters, results, and deprecations |
| [Code in text](https://developers.google.com/style/code-in-text) | Literal formatting, grammatical treatment, links, and status codes |
| [Code samples](https://developers.google.com/style/code-samples) | Introductions, language conventions, line lengths, and omitted code |
| [Placeholders](https://developers.google.com/style/placeholders) | Descriptive names, formatting, replacement instructions, and output values |
| [Filenames](https://developers.google.com/style/filenames) | Portable names, conventional exceptions, exact references, and file types |
