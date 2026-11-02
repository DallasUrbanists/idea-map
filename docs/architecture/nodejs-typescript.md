# Node.js and TypeScript architecture

A change to a shared package needs to work both as source code and as a built
dependency. Here you'll find how Node.js and TypeScript run, compile, and check
Idea Map's code, and how applications use the packages' public exports.

The following contents links navigate within this guide:

- [Compilation and types](#compilation-and-types)
- [Package exports](#package-exports)
- [Boundary enforcement](#boundary-enforcement)

## Compilation and types

The root [package manifest](../../package.json) pins Node.js 24.22.1 and
TypeScript 5.9.3. You should keep those declarations and development
instructions aligned.

The root TypeScript build compiles workspace packages before the application
build. TypeScript supplies JavaScript compilation, declaration files, and the
parser used by import-boundary checks. Nuxt generates application types, and
`vue-tsc` checks Vue components against them.

The server runtime supports ECMAScript 2020 (ES2020), including BigInt literals.
The web [Nuxt configuration](../../apps/web/nuxt.config.ts) sets the Nitro build
target accordingly. You should verify runtime compatibility when changing
compiler targets or dependencies.

## Package exports

Package cores own their public APIs and tests. Packages export built ECMAScript
modules (ESM) from `dist` with matching declaration files through the `exports`
map. Consumers must use public exports rather than private source paths;
reusable cores must not import applications, server integrations, or framework
globals.

You can find each package's contract in the
[renderer README](../../packages/street-renderer/README.md) and
[Streetmix README](../../packages/streetmix/README.md). Maintainers should
inspect built artifacts, runtime dependencies, and declaration resolution in a
clean checkout before a release, following the
[release procedure](../policies/release-procedure.md).

## Boundary enforcement

The boundary check reads JavaScript, TypeScript, and Vue component scripts to
check their imports. Vue's `compiler-sfc` supplies component parsing. The check
rejects module loading inside templates and unsupported external component
scripts, but does not audit transitive third-party imports.

You should review new aliases, file types, and dependencies against the
[workspace boundaries](architecture-overview.md#workspace-boundaries). The check
uses existing parsers rather than a separate lint framework.
