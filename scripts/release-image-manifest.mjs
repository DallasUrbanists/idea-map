import { createHash } from 'node:crypto'

const imagePattern = /^([a-z0-9-]+-docker\.pkg\.dev)\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/([a-z][a-z0-9-]{0,62})\/(idea-map-(?:web|worker))@sha256:([0-9a-f]{64})$/
const leafTypes = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'])
const indexTypes = new Set(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'])
const accept = [...indexTypes, ...leafTypes].join(', ')
const maxManifestBytes = 4 * 1024 * 1024

/** Resolve a checked image index to its single Linux amd64 manifest. */
export async function resolvePlatformImage(image, readManifest) {
  const match = typeof image === 'string' ? image.match(imagePattern) : null
  if (!match) throw new Error('Invalid immutable image reference')
  const [, registry, project, repository, name, digest] = match
  const bytes = Buffer.from(await readManifest(`https://${registry}/v2/${project}/${repository}/${name}/manifests/sha256:${digest}`))
  if (bytes.length === 0 || bytes.length > maxManifestBytes || createHash('sha256').update(bytes).digest('hex') !== digest) {
    throw new Error('Image manifest does not match the checked digest')
  }
  let manifest
  try { manifest = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('Invalid image manifest') }
  if (manifest.schemaVersion !== 2) throw new Error('Unsupported image manifest')
  if (leafTypes.has(manifest.mediaType)) return image
  if (!indexTypes.has(manifest.mediaType) || !Array.isArray(manifest.manifests)) throw new Error('Unsupported image index')
  const candidates = manifest.manifests.filter(item => item?.platform?.os === 'linux' && item.platform.architecture === 'amd64')
  if (candidates.length !== 1 || !leafTypes.has(candidates[0].mediaType) || !/^sha256:[0-9a-f]{64}$/.test(candidates[0].digest)) {
    throw new Error('Image index must contain one Linux amd64 manifest')
  }
  return `${image.slice(0, image.lastIndexOf('@'))}@${candidates[0].digest}`
}

/** Fetch a manifest without exposing the access token or following redirects. */
export async function fetchRegistryManifest(url, token, request = fetch) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !/^[a-z0-9-]+-docker\.pkg\.dev$/.test(target.hostname) ||
      target.port || target.username || target.password || target.search || target.hash ||
      typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
    throw new Error('Invalid registry request')
  }
  try {
    const response = await request(url, { headers: { authorization: `Bearer ${token}`, accept },
      redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > maxManifestBytes) throw new Error('Registry request failed')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxManifestBytes) throw new Error('Registry response too large')
    return bytes
  } catch {
    throw new Error('Unable to read image manifest from Artifact Registry')
  }
}
