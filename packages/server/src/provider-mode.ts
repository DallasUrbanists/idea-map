/** Select one configured integration without falling back to a different provider. */
export function selectProvider<T>(mode: string | undefined, factories: { offline?: () => T, provider?: () => T }): T {
  if (mode !== 'offline' && mode !== 'provider') throw new Error('Choose provider mode: offline or provider')
  const factory = factories[mode]
  if (!factory) throw new Error(`${mode} adapter is not available for this integration`)
  const result = factory()
  if (result == null) throw new Error(`${mode} adapter is not available for this integration`)
  return result
}
