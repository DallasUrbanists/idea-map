// Original fictional viewport geometry. No geographic data or third-party artwork.
const style = { background: '#FFFFFF', stroke: '#273B31', strokeWidth: 4 }
export const syntheticFixtures = [
  {
    width: 120, height: 80, title: 'Fictional crossing',
    lines: [{ points: [{ x: 0, y: 20 }, { x: 120, y: 20 }] }, { points: [{ x: 60, y: 0 }, { x: 60, y: 80 }] }],
    style, provenance: { source: 'synthetic', revision: 'crossing-1', attribution: 'Original project fixture' },
  },
  {
    width: 100, height: 60, title: 'Fictional bend',
    lines: [{ points: [{ x: 4, y: 50 }, { x: 35, y: 20 }, { x: 90, y: 10 }] }],
    style, provenance: { source: 'synthetic', revision: 'bend-1', attribution: 'Original project fixture' },
  },
]
