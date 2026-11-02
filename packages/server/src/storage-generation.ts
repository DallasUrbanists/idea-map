import type { File, Storage } from '@google-cloud/storage'

/** Address an exact Cloud Storage generation without converting its 64-bit ID to a number. */
export function exactGenerationFile(storage: Storage, bucket: string, object: string, generation: string): File {
  if (!/^[1-9][0-9]*$/.test(generation)) throw new Error('Invalid storage generation')
  const file = storage.bucket(bucket).file(object, { preconditionOpts: { ifGenerationMatch: generation } })
  // FileOptions.generation is coerced to Number by the SDK. Inject the exact
  // strings into each request instead, including streamed reads and deletes.
  file.interceptors.push({ request(options) {
    if (!('uri' in options)) throw new Error('Invalid storage request')
    return { ...options, qs: { ...options.qs, generation, ifGenerationMatch: generation } }
  } })
  return file
}
