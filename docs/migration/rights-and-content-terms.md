# Rights inventory and proposed contribution terms

Status: **draft for maintainer and legal review**. This document records evidence
and proposed operating rules; it does not itself grant rights, approve a release,
or replace the terms presented to a contributor. The current repository retains
its [Apache-2.0 license](../../LICENSE). User content, data, trademarks and
third-party code have separate rights. Do not assume Apache covers them.

## Evidence and boundaries

- The v1 reference is committed staging
  [`ee0552e3348a286b69e2540aa332217cdecd28cb`](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb).
  The [v1 README](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/README.md)
  calls the project open source but does not identify a specific license there.
- In [#93](https://github.com/DallasUrbanists/idea-map/issues/93), Hexel Colorado
  states that they own and maintain v1 and authorizes v2 reuse of v1 code to the
  extent they control its rights. This is the evidence for that permission, not
  a blanket grant for third-party code, data, logos, user submissions or other
  contributors' rights. Preserve provenance and obtain any additional required
  permissions before copying material whose rights are not established.
- The user chose that submitters retain ownership and grant a license for service
  use; the proposed terms below implement that direction. This choice is not a
  grant of rights from existing submitters and does not authorize importing their
  legacy content without checking the original terms and necessary consent.

## Operator and agreed removal policy

Dallas Urbanists operates Idea Map. The maintainer identifies Dallas Urbanists
as a 501(c)(3) nonprofit based in Dallas, Texas. Send privacy, removal and rights
requests to [contact@dallasurbanists.org](mailto:contact@dallasurbanists.org).

The maintainer selected the following requirements for implementation:

- Verify the requester's authority before acting on a removal request. Once
  removal is authorized, stop public access immediately, including public media,
  previews and cached projections.
- Delete primary stored copies of removed content within 30 days of authorized
  removal. Expire backup copies within 90 days of that same removal.
- Document any legal-hold exception, restrict access to retained copies, and
  prevent backup restoration from making removed content public again.
- Keep rail feeds and transit logos whose permissions are unverified excluded
  from v2 until [#94](https://github.com/DallasUrbanists/idea-map/issues/94)
  establishes item-specific rights and required notices. This inventory can be
  reviewed and merged with that exclusion in place.

These are agreed operating requirements, not claims that deletion, cache
invalidation or request handling has already been implemented. No response-time
commitment for processing an incoming email has been set.

## Source and third-party inventory

| Material | Evidence / status | Required action before reuse or distribution |
| --- | --- | --- |
| V2 project source | Root `LICENSE` and workspace package manifests specify Apache-2.0. | Keep the license and applicable notices; do not remove Apache or represent third-party material as project-owned. |
| V1 contributor code | Maintainer statement in #93 covers rights they control. No specific SPDX license is identified by the pinned README. | Record source revision, path, authorship and permission for each copied item. Confirm other rights holders and embedded third-party code before copying. |
| Dependencies | The [declared-license snapshot](dependency-license-inventory.tsv) lists 500 package names from the installed production dependency graph at v2 commit `a29c989c60ee9f657fa14e95f4b4a81991c3f7d4`; package metadata is not a legal clearance. | Preserve applicable license texts, copyright and NOTICE obligations, and verify bundled/transitive dependencies for the exact distribution. |
| OSM data and derived geometry | Pinned [live location source](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/liveLocationData.js) records OSM attribution and `ODbL-1.0`; [OSM copyright](https://www.openstreetmap.org/copyright) and [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) govern applicable uses. | Retain visible attribution and license link; record provenance, modifications and dates. Evaluate database share-alike and distribution obligations for the specific use. Do not treat data as Apache. |
| Rail catalogs and corrections | The pinned README describes local GeoJSON and OSM-sourced corrections; full source rights are not established by a filename. | Verify each feed, provenance, terms, modifications and correction records; #94 owns detailed fixture/artwork audit. Do not copy an unverified feed. |
| Transit agency logos/artwork | The pinned README identifies agency logos, but inclusion does not prove permission. | Verify each asset's source, license/trademark terms, and any required attribution before reuse; keep neutral alternatives where permission is unclear. |
| Streetmix | [Existing package guidance](../../packages/streetmix/README.md) points to Streetmix's terms; API and content rights are distinct. | Recheck current terms and attribution before integration or distribution; do not assume a right to copy artwork. |
| User text and photos | Submitted content is separate from project source. Existing v1 terms/consents and third-party rights in uploads are unverified. | Use the proposed service license only after review and acceptance; establish authority and a migration basis separately for existing content. |

The snapshot was generated with `pnpm licenses list --prod --json` after a
frozen install, retaining package names, versions and declared license expressions
without machine-specific paths. It includes metadata for tooling reachable in
that graph and platform-specific packages; it is not a statement that every item
is shipped. Notable declarations include `MPL-2.0` for lightningcss,
`CC-BY-4.0` for caniuse-lite, `BlueOak-1.0.0` for several packages, and dual
expressions for node-forge and type-fest. Inspect actual license files, notices,
chosen alternatives and built artifacts before release; this snapshot does not
preserve or substitute for full third-party license texts. The current v2 tree
at that commit has no tracked image, font, GeoJSON, or separate NOTICE file.

The v1 [rail directory](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/src/data/rails)
contains ten catalogs: DART Blue, Green, Orange, Red and Silver, M-Line, Dallas
Streetcar, TRE, DCTA A-train and Trinity Metro TEXRail. The v1
[logo directory](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb/public/icons/transit_logos)
contains eleven named agency/operator images: Amtrak, DART, DCTA, FlixBus,
Greyhound, M-Line, RedCoach, STAR Transit, TRE, Trinity Metro and Vonlane. These
names identify files to investigate, not permission to use the associated marks.
Each catalog and logo needs a source-specific rights and notice record before
transfer; the detailed audit is [#94](https://github.com/DallasUrbanists/idea-map/issues/94).
An inspection of the first feature's properties in each GeoJSON found feed and
route identifiers but no top-level `source`, `license` or `attribution` field;
some `shape_corrections` contain separate provenance and must not be discarded.
The eleven SVGs did not supply a clear license or permission notice in the
searched text. One STAR Transit description refers to externally hosted source
artwork; that description alone does not establish reuse rights. Until an
item-specific record is verified, none of these files is cleared for transfer.

## Proposed user content terms

Proposed submission terms, for review before publication:

> You retain ownership of the text and photos you submit. You grant the service
> operator, Dallas Urbanists, a non-exclusive, worldwide, royalty-free license to store, process,
> moderate, display and distribute your contribution as needed to operate the
> service, including creating accessible or technically compatible versions.
> You must have the rights needed to submit the material and should identify any
> required attribution. This license does not place your contribution under the
> software's Apache license or grant everyone a general right to reuse it.
> To request removal, email contact@dallasurbanists.org. After verifying your
> authority to request it, we will stop public access immediately, delete primary
> stored copies within 30 days and expire backup copies within 90 days of that
> authorized removal, subject to documented legal holds. Removal cannot recall
> copies already obtained by others.

Display supplied attribution where appropriate without exposing private contact
details. The license is intended to last for service use while content is retained,
including the limited backup retention described above. Implement the removal
process and retention limits before presenting these as operational promises.

Permitted downstream sharing, the privacy notice and the consent mechanism
remain to be settled before these become published terms. Withdrawal cannot be
promised to erase prior downloads, third-party copies or legally retained records.
Existing submissions need their own original-terms and consent review; do not
retroactively assume acceptance. Link the final terms from the submission flow
and record the accepted version when implemented. Relevant work: [#50](https://github.com/DallasUrbanists/idea-map/issues/50),
[#56](https://github.com/DallasUrbanists/idea-map/issues/56),
[#100](https://github.com/DallasUrbanists/idea-map/issues/100).

## Review and release gates

Maintain a per-item register of source URL/revision, owner, license/permission,
evidence, attribution, modifications, redistribution conditions and reviewer.
Keep third-party notices with shipped artifacts and visible attribution with
produced works as applicable; retain the exact underlying license texts where
required. [Apache 2.0 section 4](https://www.apache.org/licenses/LICENSE-2.0.html)
describes redistribution and NOTICE conditions, and does not grant general
trademark rights. Review the complete dependency and asset manifests for the
specific release rather than relying on this snapshot. Unresolved permissions
block copying the affected item; they do not justify guessing or weakening a
notice. No v1 data or assets are transferred by this document.
