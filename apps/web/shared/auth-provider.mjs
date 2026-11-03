function localPort(value, pattern) {
  const match = pattern.exec(value)
  return !!match && Number(match[1]) > 0 && Number(match[1]) <= 65535
}

/** Reject ambiguous or mixed configurations before initializing Firebase. */
export function validateBrowserAuthMode(mode, projectId, emulator) {
  if (mode === 'offline' || mode === 'emulator-popup') {
    if (!projectId.startsWith('demo-') || !localPort(emulator, /^http:\/\/(?:localhost|127\.0\.0\.1):(\d{1,5})$/)) throw new Error('Offline authentication requires a local demo emulator')
  } else if (mode === 'provider') {
    if (!projectId || projectId.startsWith('demo-') || emulator) throw new Error('Provider authentication requires a hosted project without an emulator')
  } else throw new Error('Choose browser authentication mode: offline, emulator-popup or provider')
}

/** The Docker development service is reachable by its Compose service name. */
export function validateServerAuthMode(mode, projectId, emulatorHost) {
  if (mode === 'offline') {
    if (!projectId.startsWith('demo-') || !localPort(emulatorHost, /^(?:localhost|127\.0\.0\.1|firebase):(\d{1,5})$/)) throw new Error('Offline authentication requires a local demo emulator')
  } else if (mode === 'provider') {
    if (!projectId || projectId.startsWith('demo-') || emulatorHost) throw new Error('Provider authentication requires a hosted project without an emulator')
  } else throw new Error('Choose authentication mode: offline or provider')
}
