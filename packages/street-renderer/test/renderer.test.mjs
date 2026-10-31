import { renderStreetDiagram } from '../dist/index.js'

// Synthetic viewport coordinates: no third-party artwork or geographic data.
const fixture = {
  width: 120, height: 80, title: 'Main & <Market>',
  lines: [{ points: [{ x: 0, y: 20 }, { x: 120, y: 20 }] }, { points: [{ x: 60, y: 0 }, { x: 60, y: 80 }] }],
  style: { background: '#FFFFFF', stroke: '#273B31', strokeWidth: 4 },
  provenance: { source: 'synthetic', revision: '1', attribution: 'Test fixture' },
}
const check = (condition, message) => { if (!condition) throw new Error(message) }
const rejects = (input, kind) => {
  try { renderStreetDiagram(input) } catch (error) { check(error instanceof kind, `unexpected error: ${error}`); return }
  throw new Error('expected invalid input to be rejected')
}
const first = renderStreetDiagram(fixture)
check(JSON.stringify(first) === JSON.stringify(renderStreetDiagram(fixture)), 'output must be deterministic')
check(first.svg.includes('<title>Main &amp; &lt;Market&gt;</title>'), 'title must be escaped')
check(first.svg.includes('<polyline points="0,20 120,20"/>'), 'expected geometry')
check(first.svg.includes('fill="#ffffff"'), 'colors must be canonicalized')
check(first.metadata.lineCount === 2 && first.metadata.format === 'image/svg+xml', 'expected metadata')
check(JSON.stringify(first.metadata.provenance) === JSON.stringify(fixture.provenance) && first.metadata.provenance !== fixture.provenance, 'provenance must be copied')
rejects({ ...fixture, style: { ...fixture.style, stroke: 'url(https://invalid)' } }, TypeError)
rejects({ ...fixture, width: Infinity }, TypeError)
rejects({ ...fixture, title: 'bad\u0000title' }, TypeError)
rejects({ ...fixture, lines: [{ points: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }] }, TypeError)
rejects({ ...fixture, lines: [{ points: [{ x: 0, y: 0 }] }] }, RangeError)
