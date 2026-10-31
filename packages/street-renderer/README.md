# Street diagram renderer

This private, framework-independent package exports `renderStreetDiagram` and its
TypeScript input/result types. It takes viewport dimensions, already projected
polylines, explicit style and provenance, and returns SVG text plus metadata.
The core performs no IO, provider lookup, authentication, database access or
rasterization. Callers must supply source attribution and retain it with outputs;
the metadata is not embedded as visible attribution in the image.

```ts
import { renderStreetDiagram } from '@idea-map/street-renderer'
const result = renderStreetDiagram({
  width: 120, height: 80, title: 'Example streets',
  lines: [{ points: [{ x: 0, y: 40 }, { x: 120, y: 40 }] }],
  style: { background: '#ffffff', stroke: '#273b31', strokeWidth: 4 },
  provenance: { source: 'synthetic', revision: '1', attribution: 'Example' },
})
```

Coordinates are finite SVG user units, not latitude/longitude; callers handle
projection and clipping. Width, height and stroke width must be finite and
positive, each line needs at least two finite points, and colors must be six-digit
hex values. The title is escaped and colors cannot inject CSS or URLs. Output is
deterministic for identical inputs. SVG may still be subject to an application's
content security and untrusted-input resource limits; impose size limits at the
server boundary.

The sample fixture is original synthetic geometry and uses no third-party assets.
This minimal contract does not claim v1 geometry cleanup, labels, rail catalog,
artwork or raster preview parity. Those features and provenance/license audits
belong to subsequent issues. Keep the package's source and tests independent of
workspace app imports to support a future standalone repository; publishing and
release automation require separate authorization. After the root build, run
`pnpm --filter @idea-map/street-renderer test` for the focused checks.
