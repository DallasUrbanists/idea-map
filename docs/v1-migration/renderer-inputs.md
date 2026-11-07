# Historical renderer input evidence

This inventory records predecessor data and artwork evidence for migration
review. It does not establish current behavior, permission or a legal
determination. The [historical rights inventory](rights-inventory.md) explains
the predecessor boundary and the maintainer authorization for code they control.

The following contents links navigate within this inventory:

- [Geographic data](#geographic-data)
- [Predecessor rail catalogs](#predecessor-rail-catalogs)
- [Predecessor agency artwork](#predecessor-agency-artwork)
- [Review workflow](#review-workflow)

## Geographic data

The predecessor [live location code](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/liveLocationData.js)
identifies OpenStreetMap as a source and records attribution and ODbL-1.0 for
its query context. [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
and the [ODbL text](https://opendatacommons.org/licenses/odbl/1-0/) are separate
from Apache. Maintainers should review the specific use, changes, distribution and database
obligations before shipping; these observations do not grant access to an
unverified saved extract.

## Predecessor rail catalogs

The following is an inventory of the pinned v1 files, not material copied into
this package. Feed identifiers and hashes are recorded by those files, not proof
of license, feed terms, authorship or transfer permission. The correction counts
below refer to `shape_corrections` on the single feature in each inspected file.
Maintainers should confirm each original dataset, license, attribution and correction rights before
using it. No listed catalog is currently cleared by this inventory.

| Catalog | Feed identifier / version SHA-1 | Recorded corrections |
| --- | --- | --- |
| [425](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20425%20MCKINNEY%20AVENUE%20TROLLEY.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | None recorded. |
| [620](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20620%20DALLAS%20STREETCAR.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | None recorded. |
| [BLUE](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20BLUE%20DART%20LIGHT%20RAIL%20-%20BLUE%20LINE.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | Two: Red shared geometry and 8th & Corinth alignment. |
| [GREEN](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20GREEN%20DART%20LIGHT%20RAIL%20-%20GREEN%20LINE.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | One: Bachman–Pearl normalization using Red downtown. |
| [ORANGE](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20ORANGE%20DART%20LIGHT%20RAIL%20-%20ORANGE%20LINE.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | Four: Green and Red shared-corridor normalizations. |
| [RED](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20RED%20DART%20LIGHT%20RAIL%20-%20RED%20LINE.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | Two: direction normalization and 8th & Corinth alignment. |
| [SILVER](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20SILVER%20SILVER%20LINE.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | One: approximate visual trace of Alma–CityLine/Bush; imagery rights unresolved. |
| [TRE](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/DALLAS%20AREA%20RAPID%20TRANSIT%20-%20TRE%20TRINITY%20RAILWAY.geojson) | `f-9vg-dallasarearapidtransit` / `0c7981ae5ebc0ba5f97eddf9bfa9fd90ae354cb6` | One: shared approach based on TEXRail geometry. |
| [A-train](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/Denton%20County%20Transportation%20Authority%20-%20A-train.geojson) | `f-9vfu-dentoncountytransportationauthority` / `9780f1067a2148600319b194e3775993f24a7a10` | One: western station-area alignment using source part 0. |
| [TEXRail](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails/Trinity%20Metro%20-%20TEXRail%20TEXRail.geojson) | `f-9vff-fortworthtransportationauthority` / `090ad9fd9b14f51454127f603e009bf3d4f286e5` | One: OSM Texan Trail ways and Silver shared vertices; records OSM timestamp and ODbL attribution. |

The TEXRail record identifies OSM ways 762734178, 340450022, 457745480 and
702181423 with an acquisition timestamp. Silver's recorded user-provided Google
Maps imagery reference is not evidence of a license to reproduce its traced
geometry. Cross-catalog corrections inherit the unresolved provenance of their
referenced inputs. A missing correction record means only that none was found
in that feature, not that the underlying feed was unmodified.

## Predecessor agency artwork

Each linked file is historical evidence only. An external image reference is
not a license, and an operator name or repository inclusion does not establish
trademark permission. Maintainers should verify source, rights holder, license, attribution,
modifications and permission for the intended use separately. No artwork below
is cleared for transfer; use neutral, synthetic alternatives until reviewed.

| Artwork | Observed file | Evidence still needed |
| --- | --- | --- |
| Amtrak Square | [Amtrak_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/Amtrak_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| DCTA Square | [DCTA_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/DCTA_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| Dallas Area Rapid Transit logo | [Dallas_Area_Rapid_Transit_logo.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/Dallas_Area_Rapid_Transit_logo.svg) | Source, permission and trademark terms not established by this inventory. |
| FlixBus Square | [FlixBus_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/FlixBus_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| Greyhound Square | [Greyhound_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/Greyhound_Square.svg) | Source, permission and trademark terms not established by this inventory. |
| M Line Trolley Square | [M_Line_Trolley_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/M_Line_Trolley_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| RedCoach Square | [RedCoach_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/RedCoach_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| STAR Transit Square | [STAR_Transit_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/STAR_Transit_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| TRE Square | [TRE_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/TRE_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| Trinity Metro Square | [Trinity_Metro_Square.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/Trinity_Metro_Square.svg) | External artwork reference in SVG; verify linked source and terms. |
| Vonlane Stacked | [Vonlane_Stacked.svg](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos/Vonlane_Stacked.svg) | Source, permission and trademark terms not established by this inventory. |

## Review workflow

For each proposed real input, maintainers should record the exact source and
revision, retrieval date, rights holder, license or permission evidence,
required attribution, corrections and distribution constraints. Keep source
notices alongside shipped artifacts and visible attribution in outputs when
required. Do not treat a feed hash, route URL, linked image, or successful test
as rights clearance. Resolve missing evidence before transferring that item.
Run the [package checks](../../packages/street-renderer/README.md#validation) using synthetic fixtures.
