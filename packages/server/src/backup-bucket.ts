import type { BucketMetadata } from '@google-cloud/storage'

/** Verify bucket ownership and the safeguards required by backup and recovery. */
export function verifyBackupBucket(bucket: BucketMetadata, config: { bucket: string, projectNumber: string }): void {
  if (!bucket || !config || typeof config.projectNumber !== 'string' || !/^[1-9][0-9]{5,19}$/.test(config.projectNumber) ||
      bucket.name !== config.bucket || typeof bucket.projectNumber !== 'string' || bucket.projectNumber !== config.projectNumber ||
      bucket.iamConfiguration?.publicAccessPrevention !== 'enforced' ||
      bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true || bucket.versioning?.enabled !== true ||
      (bucket.defaultEventBasedHold !== undefined && bucket.defaultEventBasedHold !== false) ||
      (bucket.hierarchicalNamespace !== undefined && bucket.hierarchicalNamespace?.enabled !== false) ||
      bucket.retentionPolicy !== undefined ||
      Boolean(bucket.encryption?.defaultKmsKeyName) ||
      (bucket.softDeletePolicy?.retentionDurationSeconds !== '604800' && bucket.softDeletePolicy?.retentionDurationSeconds !== 604800) ||
      (bucket.lifecycle !== undefined && (bucket.lifecycle === null || !Array.isArray(bucket.lifecycle.rule) ||
        bucket.lifecycle.rule.some(rule => !['SetStorageClass', 'AbortIncompleteMultipartUpload'].includes(rule.action?.type ?? ''))))) {
    throw new Error('Bucket safeguards are not confirmed')
  }
}
