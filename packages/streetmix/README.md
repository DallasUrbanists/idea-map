# Streetmix generation contracts

This private package separates provider-independent generation rules from a
caller-injected provider adapter. `GenerationInput` identifies the accepted
interpretation and its revision; `GenerationRules` turns it into a `StreetPlan`;
`DesignProvider` accepts that plan and returns a `GeneratedDesign` with its source
revision. The package does not fetch credentials, make HTTP requests, choose a
provider, persist designs, authorize users or retry failures. The application owns
those decisions and must handle timeouts, idempotency, replacement concurrency,
private data and provenance before any real integration. Provider errors propagate.

Adapters can implement `ProviderFactory` and accept `ProviderCredentials` at
construction. Pass secrets from a server-controlled source; do not place them in
browser code, URLs, logs or output metadata. The interface is a boundary, not a
claim about a particular provider's authentication scheme. The synthetic
[`examples/fake.mjs`](examples/fake.mjs) shows rules and a fake credential-injected
adapter; its token is not real. After the root build, run
`pnpm --filter @idea-map/streetmix example` and `pnpm --filter @idea-map/streetmix test`.
Real generation, provider implementation, authorization and replacement behavior
are later issues. Gemini is disabled for the pilot pending separate review.

## Provider terms and release boundary

- Streetmix's [license and attribution FAQ](https://docs.streetmix.net/user-guide/support/faq/)
  describes AGPL for its software and CC BY-SA for its content, with attribution
  guidance. Its [terms of use](https://about.streetmix.net/terms-of-use/) and the
  applicable API access conditions need review before connecting a real adapter.
  This contract neither imports Streetmix code/assets nor establishes API rights.
- Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) distinguish
  paid and unpaid data handling and contain age, region and other restrictions.
  Review current terms, privacy and eligibility before any enablement; this package
  makes no Gemini calls and does not authorize the pilot to use it.
- Keep provider code, terms and asset obligations separate from this project's
  license. Recheck terms when an integration is proposed; this overview is not a
  license determination. Package imports contain no app or framework dependencies,
  supporting a future standalone repository. Publishing is not part of this work.
