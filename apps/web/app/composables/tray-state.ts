export type TrayRank = 0 | 1 | 2
export interface TrayMetrics { height: number; mediumOffset: number; scrollable: boolean }
export function trayMetrics(natural: number, medium: number, maximum: number, available: number): TrayMetrics {
  const positive = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1
  const limit = Math.min(positive(maximum), positive(available))
  const mediumSize = Math.min(positive(medium), limit)
  const scrollable = positive(natural) > mediumSize + 1
  const height = scrollable ? limit : Math.min(positive(natural), limit)
  return { height, mediumOffset: scrollable ? Math.max(0, height - mediumSize) : 0, scrollable }
}
export const trayOffset = (rank: TrayRank, metrics: TrayMetrics) => rank === 0 ? metrics.height : rank === 1 ? metrics.mediumOffset : 0
export function allowedTrayRanks(start: TrayRank, scrollable: boolean, canOpen: boolean, canClose: boolean): TrayRank[] {
  return ([0, 1, ...(scrollable ? [2] : [])] as TrayRank[]).filter(rank => rank === start || (rank > start ? canOpen : canClose))
}
export function snapTray(start: TrayRank, offset: number, metrics: TrayMetrics, canOpen: boolean, canClose: boolean, velocity = 0, distance = 0): TrayRank {
  const ranks = allowedTrayRanks(start, metrics.scrollable, canOpen, canClose)
  if (Math.abs(distance) >= 12 && Math.abs(velocity) >= 0.5) {
    const next = Math.max(0, Math.min(2, start + (velocity < 0 ? 1 : -1))) as TrayRank
    return ranks.includes(next) ? next : start
  }
  return ranks.reduce((nearest, rank) => Math.abs(trayOffset(rank, metrics) - offset) < Math.abs(trayOffset(nearest, metrics) - offset) ? rank : nearest, ranks[0] ?? start)
}
