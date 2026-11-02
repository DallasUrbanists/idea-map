/**
 * Calculate the adopted standard review window for a complete, validated score.
 * A null result requires human review. This function does not validate an
 * assessment, establish policy coverage, or authorize automatic publication.
 */
export function standardReviewWaitMilliseconds(score: number): number | null {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid compliance score')
  if (score < 60) return null
  if (score >= 95) return 0
  // Round up to the next representable millisecond so storage never shortens the window.
  return Math.ceil(86_400_000 * (95 - score) / 35)
}
