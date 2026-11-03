# Verify reuse rights

Before you bring code, data, artwork, or other material into Idea Map, use this
guide to check its source, permission, and attribution. The repository's
[Apache-2.0 license](../../LICENSE) covers project software; other material can
have separate owners and terms. The [historical rights inventory](../v1-migration/rights-inventory.md)
is a starting point for investigating predecessor material, not permission to
copy every item it describes.

The following contents links navigate within this guide:

- [Check an input](#check-an-input)
- [Review a release](#review-a-release)

## Check an input

For each input you intend to copy, adapt, display, or distribute, you should
follow these steps before use:

1. Identify the exact material, its source URL and revision or version, its
    owner, and how Idea Map will use it. Trace bundled or embedded material
    separately when someone else owns it.
2. Record the applicable license or permission and its evidence, any required
    attribution and notices, modifications, redistribution conditions, and the
    reviewer. Keep the record with the contribution or its review evidence so
    another contributor can trace the decision.
3. Check that the evidence covers the intended use and that required notices,
    license texts, and attribution can accompany the material. If ownership,
    permission, or an obligation is unresolved, exclude that item until it is
    resolved; a filename or inclusion in another project is not permission.
4. Preserve required notices and make attribution visible where the terms call
    for it. When using OpenStreetMap data, consult its
    [copyright and attribution guidance](https://www.openstreetmap.org/copyright)
    for the output and evaluate the applicable database obligations.

The application excludes rail feeds and transit logos with unverified
permissions. The historical inventory identifies known candidates for review;
it does not clear those candidates for transfer. The
[Streetmix package guidance](../../packages/streetmix/README.md#provider-terms-and-release-boundary)
describes separate provider, software, and content considerations.

For submitted text and photos, use the separate
[Terms of Use](../policies/terms-of-use-policy.md#ownership-and-service-license).
The terms for a new submission do not establish permission to import an existing
submission; review its original terms and any necessary consent separately.

## Review a release

The [release procedure](../policies/release-procedure.md) covers authorization
and artifact review. Before a release, maintainers should check the actual
artifacts and their inputs, including bundled dependencies and assets, against
the recorded permission and notice requirements. Preserve the applicable
license texts and notices in the distributed artifacts and verify visible
attribution in the relevant outputs.

The [pnpm guide](../architecture/pnpm.md#license-review) explains how to
generate dependency license metadata. Treat that metadata as a starting point:
inspect the actual shipped files and their license texts, including material
included by build tooling, rather than assuming a package's declared license
clears every file. Resolve or exclude an input when its rights or required
notices cannot be verified.
