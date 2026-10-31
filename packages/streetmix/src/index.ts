/** Accepted interpretation supplied by the calling application. */
export interface GenerationInput {
  readonly ideaId: string
  readonly interpretationRevision: string
  readonly description: string
}
/** Provider-independent output of a generation rule. */
export interface StreetPlan {
  readonly name: string
  readonly segments: readonly { readonly kind: string; readonly widthMeters: number }[]
}
export interface GeneratedDesign {
  readonly provider: string
  readonly designId: string
  readonly sourceRevision: string
}
/** Pure rules do not read credentials or make provider requests. */
export interface GenerationRules {
  plan(input: GenerationInput): StreetPlan
}
/** Implemented by an adapter owned by the caller; errors propagate to the caller. */
export interface DesignProvider {
  create(plan: StreetPlan, context: { readonly sourceRevision: string }): Promise<GeneratedDesign>
}
/** Credentials are passed to an adapter factory, never read by the core. */
export interface ProviderCredentials { readonly accessToken: string }
export interface ProviderFactory {
  create(credentials: ProviderCredentials): DesignProvider
}

/** Demonstrates the boundary; authorization, retries and persistence belong to the caller. */
export async function generateDesign(input: GenerationInput, rules: GenerationRules, provider: DesignProvider): Promise<GeneratedDesign> {
  const plan = rules.plan(input)
  return provider.create(plan, { sourceRevision: input.interpretationRevision })
}
