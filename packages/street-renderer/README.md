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

The [synthetic fixtures](test/fixtures/synthetic.mjs) contain original fictional
viewport coordinates and styles; they use no third-party assets. They exercise
polylines only and do not establish rail or agency artwork support. The
[historical renderer input inventory](../../docs/v1-migration/renderer-inputs.md)
records source evidence and unresolved rights. The
[reuse rights guide](../../docs/contributor-guides/reuse-rights-guide.md) describes
permission and attribution checks before using real inputs.
The application owns geometry acquisition, labels, asset permissions, and raster
previews around the core renderer; the [renderer inputs](../../docs/architecture/architecture-overview.md#workspace-boundaries)
remain provider independent. Keep the package's source and tests independent of
workspace app imports to preserve package independence; publishing and release automation require
separate authorization.

## Validation

After the root build, run `pnpm --filter @idea-map/street-renderer test` for the
focused checks. These tests do not establish clearance for real-world inputs.
