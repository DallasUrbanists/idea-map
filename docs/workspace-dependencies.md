# Workspace dependency decision

The workspace uses TypeScript 5.9.3 and pnpm 11.25.0 on Node 24.22.1,
a Node 24 LTS release. TypeScript supplies compilation, declarations and the
parser used by the boundary check. Vue's compiler-sfc 3.5.44 parses component
scripts for the same check. This avoids a separate lint framework in the initial
workspace. pnpm supplies workspace linking and a committed lockfile.

The web and worker are private applications. Contracts are shared without
framework or provider globals; server adapters stay server-only. The street
renderer and Streetmix generator are independent package cores, with no imports
from applications or server integrations. Provider clients and configuration
must be supplied through explicit interfaces. The workspace is Apache-2.0;
dependencies and future imported assets require their own license review.
The initial dependencies report Apache-2.0, MIT, ISC, BSD-2-Clause, and
BSD-3-Clause licenses via `pnpm licenses list`.

The boundary check inspects JavaScript, TypeScript, and Vue component scripts
in the workspace. It rejects module loading in Vue templates and unsupported
external component scripts, and does not audit transitive third-party imports.
New aliases, file types, and dependencies need review as the application grows.

This is scaffolding, not a production application or an npm release. The Nuxt
application, worker, actual contracts, functionality, package release procedures,
and full developer setup belong to their respective issues.
