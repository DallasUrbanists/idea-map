# Saved-content compatibility fixtures

Contributors can use these synthetic fixtures to inspect predecessor saved-content
shapes without opening browser storage or importing data. This record describes
source at commit `ee0552e3348a286b69e2540aa332217cdecd28cb`; it does not establish
what any deployed browser contains or define a complete migration mapping.

The following contents links navigate within this guide:

- [Source-observed structures](#source-observed-structures)
- [Inspection boundaries](#inspection-boundaries)
- [Origins and transition](#origins-and-transition)
- [Offline checks](#offline-checks)

## Source-observed structures

The three pinned services used these browser-local keys and version-1 JSON
objects. Their maps used object property names as keys; the examples in this
repository are synthetic and contain no copied user data or artwork.

| Service and storage key | Structure and validation observed in the source |
| --- | --- |
| [Bookmarks](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/bookmarks.js): `improvement_map_bookmarks_v1` | `{ version: 1, saved: {} }`. Each `saved` entry contains `suggestion` and `savedAt`; the reader required `suggestion.id` to equal its map key, `suggestion.content.summary` to be a string, and `savedAt` to parse as a date. The writer also constructed photo, location, creation-date, and emoji fields, which the reader did not require. |
| [Actions](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/localActions.js): `improvement_map_actions_v1` | `{ version: 1, saved: {}, hidden: {}, generated: {} }`. Saved entries contain an `action`, string `suggestionId`, string `suggestionSummary`, and parseable string `savedAt`; hidden entries have the value `true`; generated entries contain a string `fingerprint` and an `actions` array. Each saved or generated action must have string `key`, `summary`, `instructions`, `reason`, and `sourceUrl` fields. |
| [Representatives](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/savedRepresentatives.js): `improvement_map_representatives_v1` | `{ version: 1, saved: {} }`. Each entry contains a `representative`, string `suggestionId`, and parseable `savedAt`; the reader compared `String(representative.id)` with the map key and required a string `representative.name`. The writer stored the supplied representative and stringified the associated suggestion identifier. |

The action writer keyed saved and hidden entries by action key, removed a saved
action when hiding it, and keyed generated results by stringified suggestion
identifier. The lookup checked the stored fingerprint before returning results. Its reader did not require the saved map key to
match `action.key`. The action normalizer constructed keys from a suggestion
identifier, a catalog-or-attached marker, and an action identifier; other fields
such as `id` and `catalogId` were not required by the reader. Generated entries
had no timestamp requirement in that reader.

The bookmark and representative readers used `Date.parse` without first
requiring a string timestamp. The representative reader stringified the
identifier for comparison, including unusual inputs; those source checks do not
prove that all such values were valid identities. The bookmark and representative
writers used `Object.defineProperty` for saved keys. Inspection of an unusual
key does not prove that every predecessor action write or later operation handled
that key safely.

## Inspection boundaries

The [inspection helper](../../scripts/v1-saved-content.mjs) accepts a category
and a JSON string, or an explicitly injected storage fake for a single read. It
returns a status and, for accepted version-1 data, the parsed value with unknown
fields intact. It never writes, clears, imports, or accesses browser storage by
itself. Missing values, malformed JSON, unsupported versions, invalid entries,
and read errors do not yield replacement data.

The helper deliberately requires string timestamps and explicit string or number
representative identifiers. Those checks are narrower than the predecessor
readers' coercion, so rejection does not prove that the predecessor rejected the
same bytes. The helper uses finite `Date.parse` results, not strict ISO date
validation. It reports a missing storage value separately and treats an empty
string as invalid; the predecessor readers treated a missing or empty value as an
empty default. Contributors should retain and review rejected data instead of
inferring a repair, merge rule, or import result from this helper.

## Origins and transition

Browser-local storage belongs to its browser origin and cannot be assumed
available to a different origin. The maintainer selected an explicit,
user-controlled export from the original origin and import at the destination
in [issue 101](https://github.com/DallasUrbanists/idea-map/issues/101). That
issue owns transition design and recovery; this fixture slice neither implements
transfer nor determines how existing data is merged. The selected direction
retains original data until restoration is verified.

## Offline checks

After completing the [checkout setup](../contributor-guides/development-guide.md#one-time-setup-for-each-checkout),
contributors can run the synthetic tests from the repository root:

```sh
node --test scripts/v1-saved-content.test.mjs
```

The tests use [fixture files](../../scripts/fixtures/v1-saved-content) and an
in-memory storage fake. The intentionally malformed fixture is test input; the
checks do not access an actual browser, network provider, or live user data.
