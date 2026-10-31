/** Coordinates are already projected into the output viewport, in SVG user units. */
export interface Point { readonly x: number; readonly y: number }
export interface StreetLine { readonly points: readonly Point[] }
export interface RendererStyle {
  /** Six-digit hexadecimal colors; no CSS expressions or external references. */
  readonly background: string
  readonly stroke: string
  readonly strokeWidth: number
}
export interface Provenance {
  readonly source: string
  readonly revision: string
  readonly attribution: string
}
export interface RenderInput {
  readonly width: number
  readonly height: number
  readonly title: string
  readonly lines: readonly StreetLine[]
  readonly style: RendererStyle
  readonly provenance: Provenance
}
export interface RenderResult {
  readonly svg: string
  readonly metadata: {
    readonly format: 'image/svg+xml'
    readonly width: number
    readonly height: number
    readonly lineCount: number
    readonly provenance: Provenance
  }
}

const escapeText = (value: string): string => {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) throw new TypeError('title contains invalid XML characters')
  }
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}
const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
  return value
}
const positive = (value: number, name: string): number => {
  finite(value, name)
  if (value <= 0) throw new RangeError(`${name} must be positive`)
  return value
}
const color = (value: string, name: string): string => {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new TypeError(`${name} must be a six-digit hex color`)
  return value.toLowerCase()
}

/** Render supplied viewport geometry without network, filesystem or framework state. */
export function renderStreetDiagram(input: RenderInput): RenderResult {
  const width = positive(input.width, 'width')
  const height = positive(input.height, 'height')
  const strokeWidth = positive(input.style.strokeWidth, 'strokeWidth')
  const background = color(input.style.background, 'background')
  const stroke = color(input.style.stroke, 'stroke')
  const lines = input.lines.map((line, lineIndex) => {
    if (line.points.length < 2) throw new RangeError(`line ${lineIndex} must have at least two points`)
    const points = line.points.map(point => `${finite(point.x, 'x')},${finite(point.y, 'y')}`).join(' ')
    return `<polyline points="${points}"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeText(input.title)}</title><rect width="${width}" height="${height}" fill="${background}"/><g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${lines}</g></svg>`
  return { svg, metadata: { format: 'image/svg+xml', width, height, lineCount: input.lines.length, provenance: { ...input.provenance } } }
}
