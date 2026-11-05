# Dictation recovery model

Contributors can use the provider-free dictation model to prepare and review a
synthetic transcript without changing a draft until the caller explicitly applies
it. The model does not start speech recognition, use a microphone, provide a
user interface, or store data.

The following contents links navigate within this guide:

- [State and transitions](#state-and-transitions)
- [Ownership and safe commits](#ownership-and-safe-commits)
- [Offline checks](#offline-checks)

## State and transitions

The model in [`dictation-recovery.ts`](../../apps/web/app/utils/dictation-recovery.ts)
accepts a draft snapshot containing text and a nonempty revision. `startDictation`
copies that snapshot; `updateDictation` replaces separate interim and final
transcript values. `reviewDictation` changes the state to Review without changing
the draft. A caller can discard a recording or review, which removes the stored
snapshot and transcript from the returned state.

For a reviewed, nonempty final transcript, `applyDictation` accepts the current
draft, an explicitly reviewed replacement, and a new revision. The caller chooses
how to combine the transcript and draft; the model does not append or replace
text implicitly. `undoDictation` proposes restoring the original after an apply.
Empty final transcripts produce no draft change. Repeated or out-of-order actions
return an unavailable result, except repeated Review and Discard, which are
safe to repeat.

`serializeDictation` returns a string for valid state, and `restoreDictation`
validates a saved string and returns a copied state or null. The serialized state
contains draft and transcript text where needed for recovery; it is not a public
or anonymized record. Invalid or missing state yields no draft change, and
unknown fields are omitted from valid state.

## Ownership and safe commits

The caller owns draft revisions, storage, and application of changes. Every draft
edit should receive a unique revision, including edits that restore previous
text. The model compares both text and revision before proposing Apply or Undo;
a mismatch returns a conflict and no replacement.

Apply and Undo return the expected draft, proposed draft, and next recovery state;
they do not write any of them. The caller should compare the expected draft with
the current stored draft and atomically commit the proposed draft and recovery
state only if they still match. A failed comparison must leave both untouched.
The caller should allocate a new, never-reused revision for each successful
commit and handle conflicts without overwriting newer edits. Structural validation
cannot authenticate a deliberately altered saved state; the storage owner should
protect its integrity and access.

The caller should keep recovery data private, avoid logging draft or transcript
content, and remove recovery records according to the draft's retention policy.
The model does not choose storage or implement persistence, browser lifecycle,
accessibility, or the submission interface. Those integrations need separate
verification with synthetic data.

## Offline checks

After completing the [checkout setup](../contributor-guides/development-guide.md#one-time-setup-for-each-checkout),
contributors can run the focused synthetic tests from the repository root:

```sh
node --test scripts/dictation-recovery.test.mjs
```

The tests use an in-memory persistence fake and require no provider, service,
microphone, or user data. The [testing guide](../contributor-guides/testing-guide.md)
describes aggregate checks.
