export type MapPresentation = 'auto' | 'desktop' | 'app'
export interface ViewportMetrics { width: number; height: number; finePointer: boolean }
export interface SurfaceBounds { top: number; right: number; bottom: number; left: number; width: number; height: number; dragging?: boolean }
export interface MapInsets { top: number; right: number; bottom: number; left: number }

export function resolveMapLayout(metrics: ViewportMetrics, presentation: MapPresentation = 'auto') {
  const desktop = presentation === 'desktop' || (presentation === 'auto' && metrics.width >= 1200 && metrics.finePointer)
  const landscapeTablet = metrics.width > metrics.height && Math.min(metrics.width, metrics.height) >= 600
  return { presentation: desktop ? 'desktop' as const : 'app' as const, placement: desktop || landscapeTablet ? 'side' as const : 'bottom' as const }
}

export function mapOcclusion(shell: SurfaceBounds, tray: SurfaceBounds | null, search: SurfaceBounds | null, railWidth: number, placement: 'bottom' | 'side'): MapInsets {
  const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : 0))
  return {
    top: search ? clamp(search.bottom - shell.top + 8, shell.height) : 0,
    right: 0,
    bottom: tray && placement === 'bottom' && tray.height > 0 ? clamp(shell.bottom - tray.top, shell.height) : 0,
    left: tray && placement === 'side' && tray.width > 0 ? clamp(tray.right - shell.left, shell.width) : clamp(railWidth, shell.width),
  }
}
