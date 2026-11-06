import { createGoogleRemovalTransports, placeHoldThroughRecoveryJournal, readJournaledHoldPlacementRequest, readJournaledRemovalRequest, removeThroughRecoveryJournal, type RegisteredSessionVerifier } from '@idea-map/server'
import { createError, defineEventHandler, getCookie, getHeader, setResponseHeader, type H3Event } from 'h3'
import { allowsSessionMutation } from './session-csrf.mjs'

type RemovalConfig = {
  databaseUrl: string
  sessionOrigin: string
  firebaseProjectId: string
  authProviderMode: string
  journaledRemoval: {
    enabled: boolean
    holdPlacementEnabled?: boolean
    preparationDatabaseUrl: string
    coordinatorDatabaseUrl: string
    environment: string
    projectNumber: string
    secretId: string
    epochId: string
    checkpointDigest: string
    writerAccount: string
    readerAccount: string
  }
}

// The reader and both mutation roles must point to the same branch and database.
function requireSeparateRemovalRoles(connectionStrings: string[]) {
  const allowedParameters = new Set(['sslmode', 'sslrootcert', 'channel_binding', 'gssencmode'])
  const urls = connectionStrings.map(connectionString => {
    const url = new URL(connectionString)
    const parameters = [...url.searchParams.keys()]
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash ||
        url.pathname.length < 2 || !url.username || !url.password || new Set(parameters).size !== parameters.length ||
        parameters.some(key => !allowedParameters.has(key))) throw new Error('Invalid removal database')
    return url
  })
  const [publicDatabase] = urls
  const database = (url: URL) => [url.hostname, url.port || '5432', decodeURIComponent(url.pathname)].join(':')
  if (urls.some(url => database(url) !== database(publicDatabase!)) ||
      new Set(urls.map(url => decodeURIComponent(url.username))).size !== urls.length) throw new Error('Invalid removal roles')
}

type GetConfig = (event: H3Event) => RemovalConfig
type GetVerifier = (projectId: string, mode: string) => RegisteredSessionVerifier

function createJournaledDecisionHandler<Input, Value>(
  getConfig: GetConfig,
  getVerifier: GetVerifier,
  getTransports: typeof createGoogleRemovalTransports,
  options: {
    enabled: (config: RemovalConfig['journaledRemoval']) => boolean
    parse: (body: unknown) => Input | null
    apply: (preparationDatabaseUrl: string, coordinatorDatabaseUrl: string, projectId: string, cookie: string,
      verifier: RegisteredSessionVerifier, target: Parameters<typeof removeThroughRecoveryJournal>[5],
      transports: ReturnType<typeof createGoogleRemovalTransports>, input: Input) =>
      Promise<{ state: 'unauthenticated' | 'forbidden' } | { state: 'authorized', value: 'stale' | 'reconciliation_required' | Value }>
    conflict: string
    unavailable: string
  },
) {
  let cached: { writerAccount: string, readerAccount: string, transports: ReturnType<typeof createGoogleRemovalTransports> } | undefined
  return defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    const config = getConfig(event)
    const { journaledRemoval: journal } = config
    if (!options.enabled(journal)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    if (!allowsSessionMutation({ origin: getHeader(event, 'origin'), expectedOrigin: config.sessionOrigin,
      contentType: getHeader(event, 'content-type'), requestedWith: getHeader(event, 'x-idea-map-session') })) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
    const cookie = getCookie(event, '__session')
    if (!cookie) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })

    const maxBytes = 4096
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxBytes) {
        event.node.req.resume()
        throw createError({ statusCode: 413, statusMessage: 'Request too large' })
      }
      chunks.push(buffer)
    }
    let body: unknown
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
    catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request' }) }
    const input = options.parse(body)
    if (!input) throw createError({ statusCode: 400, statusMessage: 'Invalid request' })

    let result
    try {
      const { preparationDatabaseUrl, coordinatorDatabaseUrl, environment, projectNumber, secretId, epochId, checkpointDigest } = journal
      if (environment !== 'dev' && environment !== 'prod') throw new Error('Invalid removal environment')
      requireSeparateRemovalRoles([config.databaseUrl, preparationDatabaseUrl, coordinatorDatabaseUrl])
      const verifier = getVerifier(config.firebaseProjectId, config.authProviderMode)
      const { writerAccount, readerAccount } = journal
      if (!cached || cached.writerAccount !== writerAccount || cached.readerAccount !== readerAccount) {
        cached = { writerAccount, readerAccount, transports: getTransports(writerAccount, readerAccount) }
      }
      result = await options.apply(preparationDatabaseUrl, coordinatorDatabaseUrl, config.firebaseProjectId, cookie,
        verifier, { environment, projectNumber, secretId, epochId, checkpointDigest }, cached.transports, input)
    } catch {
      throw createError({ statusCode: 503, statusMessage: options.unavailable })
    }
    if (result.state === 'unauthenticated') throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    if (result.state !== 'authorized') throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    if (result.value === 'stale') throw createError({ statusCode: 409, statusMessage: options.conflict })
    if (result.value === 'reconciliation_required') throw createError({ statusCode: 503, statusMessage: options.unavailable })
    return result.value
  })
}

export function createJournaledRemovalHandler(getConfig: GetConfig, getVerifier: GetVerifier, getTransports = createGoogleRemovalTransports) {
  return createJournaledDecisionHandler(getConfig, getVerifier, getTransports, {
    enabled: config => config.enabled === true,
    parse: readJournaledRemovalRequest,
    apply: removeThroughRecoveryJournal,
    conflict: 'Removal conflicts with current state',
    unavailable: 'Removal requires reconciliation',
  })
}

export function createJournaledHoldPlacementHandler(getConfig: GetConfig, getVerifier: GetVerifier, getTransports = createGoogleRemovalTransports) {
  return createJournaledDecisionHandler(getConfig, getVerifier, getTransports, {
    enabled: config => config.holdPlacementEnabled === true,
    parse: readJournaledHoldPlacementRequest,
    apply: placeHoldThroughRecoveryJournal,
    conflict: 'Hold conflicts with current state',
    unavailable: 'Hold requires reconciliation',
  })
}
