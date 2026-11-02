# Streetmix generation contracts

This private package separates provider-independent generation rules from a
caller-injected provider adapter. `GenerationInput` identifies the accepted
interpretation and its revision; `GenerationRules` turns it into a `StreetPlan`;
`DesignProvider` accepts that plan and returns a `GeneratedDesign` with its source
revision. The package does not fetch credentials, make HTTP requests, choose a
provider, persist designs, authorize users or retry failures. The application owns
those decisions and must handle timeouts, idempotency, replacement concurrency,
private data and provenance at the integration boundary. Provider errors propagate.

Adapters can implement `ProviderFactory` and accept `ProviderCredentials` at
construction. Pass secrets from a server-controlled source; do not place them in
browser code, URLs, logs or output metadata. The interface is a boundary, not a
claim about a particular provider's authentication scheme. The synthetic
[`examples/fake.mjs`](examples/fake.mjs) shows rules and a fake credential-injected
adapter; its token is not real. After the root build, run
`pnpm --filter @idea-map/streetmix example` and `pnpm --filter @idea-map/streetmix test`.
The [Streetmix architecture guide](../../docs/architecture/streetmix.md) defines
application integration. Gemini is disabled unless its use, data handling, and
access requirements are resolved through a reviewed change.

## Provider terms and release boundary

- Streetmix's [license and attribution FAQ](https://docs.streetmix.net/user-guide/support/faq/)
  describes AGPL for its software and CC BY-SA for its content, with attribution
  guidance. Its [terms of use](https://about.streetmix.net/terms-of-use/) and the
  applicable API access conditions need review before connecting a real adapter.
  This contract neither imports Streetmix code/assets nor establishes API rights.
- Google's [Gemini API terms](https://ai.google.dev/gemini-api/terms) describe
  data handling and contain age, region, and other restrictions.
  Review current terms, privacy and eligibility before enablement; the application
  must enforce its documented Gemini enablement boundary.
- Keep provider code, terms and asset obligations separate from this project's
  license. Recheck terms when an integration changes; this overview is not a
  license determination. Package imports contain no app or framework dependencies,
  preserving package independence. Publishing requires explicit authorization.
