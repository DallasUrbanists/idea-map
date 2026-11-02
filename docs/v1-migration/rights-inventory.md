# Historical rights inventory

Before reusing material from the predecessor app, you need to know where it
came from and what permission exists to use it. This inventory gathers that
historical evidence; it does not establish current application requirements.
The [migration overview](README.md) explains its scope and terminology.

This inventory preserves source and permission evidence for migration review.
The repository's [Apache-2.0 license](../../LICENSE) covers project software;
user content, datasets, trademarks, and third-party code have separate rights.

The following contents links navigate within this guide:

- [Evidence and boundaries](#evidence-and-boundaries)
- [Source and third-party inventory](#source-and-third-party-inventory)
- [Review and release gates](#review-and-release-gates)

## Evidence and boundaries

The v1 reference is committed staging
[`ee0552e3348a286b69e2540aa332217cdecd28cb`][ee0552e3348a286b69e2540aa332217cdecd28cb].
The [v1 README][v1-readme] calls the project open source but does not identify a
specific license there.

In [#93][93], Hexel Colorado states that they own and maintain v1 and authorize
v2 reuse of v1 code to the extent they control its rights. This is evidence for
that permission, not a blanket grant for third-party code, data, logos, user
submissions, or other contributors' rights.

The evidence does not establish permission to copy material with unresolved
rights. Provenance and item-specific permission records remain necessary
evidence for assessing any transfer.

Existing submissions require their own original-terms and consent review.
Permission for software reuse does not establish permission to import user
content.

## Source and third-party inventory

The following inventory records the available evidence and outstanding reuse
checks:

| Material | Evidence / status | Required action before reuse or distribution |
| --- | --- | --- |
| V2 project source | Root `LICENSE` and workspace package manifests specify Apache-2.0. | Keep the license and applicable notices; do not remove Apache or represent third-party material as project-owned. |
| V1 contributor code | Maintainer statement in #93 covers rights they control. No specific *Software Package Data Exchange (SPDX)* license is identified by the pinned README. | Record source revision, path, authorship and permission for each copied item. Confirm other rights holders and embedded third-party code before copying. |
| Dependencies | Workspace `package.json` manifests declare direct dependencies; [`pnpm-lock.yaml`](../../pnpm-lock.yaml) records resolved versions and transitive dependencies. | Generate license metadata for release review; preserve applicable license texts, copyright and NOTICE obligations, and verify dependencies in the actual distribution. |
| *OpenStreetMap (OSM)* data and derived geometry | Pinned [live location source][live-location-source] records OSM attribution and `ODbL-1.0`; [OSM copyright][osm-copyright] and [ODbL][odbl] govern applicable uses. | Retain visible attribution and license link; record provenance, modifications and dates. Evaluate database share-alike and distribution obligations for the specific use. Do not treat data as Apache. |
| Rail catalogs and corrections | The pinned README describes local GeoJSON and OSM-sourced corrections; full source rights are not established by a filename. | Verify each feed, provenance, terms, modifications and correction records; #94 owns detailed fixture/artwork audit. Do not copy an unverified feed. |
| Transit agency logos/artwork | The pinned README identifies agency logos, but inclusion does not prove permission. | Verify each asset's source, license/trademark terms, and any required attribution before reuse; keep neutral alternatives where permission is unclear. |
| Streetmix | [Existing package guidance](../../packages/streetmix/README.md) points to Streetmix's terms; API and content rights are distinct. | Recheck current terms and attribution before integration or distribution; do not assume a right to copy artwork. |
| User text and photos | Submitted content is separate from project source. Existing v1 terms/consents and third-party rights in uploads are unverified. | Consult the authoritative Terms of Use for new submissions; establish authority and a migration basis separately for existing content. |

For a release review, you should install the locked dependencies and generate
license metadata with `pnpm licenses list --prod --json`. The report may include
tooling and platform-specific packages; check which files actually ship. Review
their license texts and notices rather than treating declared package metadata
as clearance. A separate committed dependency-license snapshot is not
maintained.

The v1 [rail directory][rail-directory] contains ten catalogs: DART Blue, Green,
Orange, Red, and Silver, M-Line, Dallas Streetcar, TRE, DCTA A-train, and
Trinity Metro TEXRail.

The v1 [logo directory][logo-directory] contains eleven named agency/operator
images: Amtrak, DART, DCTA, FlixBus, Greyhound, M-Line, RedCoach, STAR Transit,
TRE, Trinity Metro, and Vonlane. These names identify files to investigate, not
permission to use the associated marks. Each catalog and logo needs a
source-specific rights and notice record before transfer; the detailed audit is
[#94][94].

An inspection of the first feature's properties in each GeoJSON found feed and
route identifiers but no top-level `source`, `license` or `attribution` field;
some `shape_corrections` contain separate provenance and must not be discarded.

The eleven *Scalable Vector Graphics (SVG)* files did not supply a clear license
or permission notice in the searched text. One STAR Transit description refers
to externally hosted source artwork; that description alone does not establish
reuse rights. Until an item-specific record is verified, none of these files is
cleared for transfer.

## Review and release gates

When you review migration rights, you should keep a record for each item of
source URL/revision, owner, license/permission, evidence, attribution,
modifications, redistribution conditions, and reviewer. Keep third-party notices
with shipped artifacts and visible attribution with produced works as
applicable; retain the exact underlying license texts where required.
[Apache 2.0 section 4][apache-2-0-section-4] describes redistribution and
`NOTICE` conditions, and does not grant general trademark rights.

For the specific release, you should review the complete dependency and asset
manifests for the specific release rather than relying on declared package
metadata alone. Unresolved permissions block copying the affected item; they do
not justify guessing or weakening a notice. This inventory transfers no v1 data
or assets.

[ee0552e3348a286b69e2540aa332217cdecd28cb]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb
[v1-readme]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/README.md
[93]: https://github.com/DallasUrbanists/idea-map/issues/93
[live-location-source]: https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/liveLocationData.js
[osm-copyright]: https://www.openstreetmap.org/copyright
[odbl]: https://opendatacommons.org/licenses/odbl/1-0/
[rail-directory]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails
[logo-directory]: https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos
[94]: https://github.com/DallasUrbanists/idea-map/issues/94
[apache-2-0-section-4]: https://www.apache.org/licenses/LICENSE-2.0.html
