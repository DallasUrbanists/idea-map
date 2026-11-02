# Docker architecture

Docker runs the database and sign-in emulators on your computer and can also
run the app itself. This guide helps you understand how those services connect
and what happens to their data when you stop them. The
[development guide](../contributor-guides/development-guide.md) has the steps
for starting and ending a session.

The following contents links navigate within this guide:

- [Services and isolation](#services-and-isolation)
- [Networking and configuration](#networking-and-configuration)
- [Storage and lifecycle](#storage-and-lifecycle)

## Services and isolation

The root [Compose file](../../compose.yaml) defines PostGIS, Firebase emulators,
and an optional `tools` profile running Nuxt and Storybook. The database image
is `postgis/postgis:17-3.6`; the emulator and tools images use
[`dev/Dockerfile.firebase`](../../dev/Dockerfile.firebase) and
[`dev/Dockerfile.tools`](../../dev/Dockerfile.tools).

The service helper gives each checkout its own Compose project name based on its
path. Each checkout has separate containers and volumes. The published ports are
fixed, so two checkouts cannot run these services at the same time. Published
ports bind loopback only.

## Networking and configuration

Host processes reach PostGIS at `127.0.0.1:54329`, Auth at `127.0.0.1:9099`, and
Firestore at `127.0.0.1:8080`. Inside the tools container, the Domain Name
System (DNS) resolves the service names `db` and `firebase`. The browser still
connects to the emulators through the host computer's loopback URLs.

Compose loads the root `.env` and overrides database addresses and the
server-side Auth emulator host inside the tools container. Nuxt and Storybook
publish ports 3000 and 6006. You should choose the native or tools-container
workflow because both use the same application ports.

## Storage and lifecycle

Named volumes keep database data, dependencies, emulator downloads, build
outputs, and tool caches between sessions. Auth accounts and Firestore records
are in memory and disappear when the emulator stops. Stopping containers
preserves named volumes; closing a log viewer does not stop services.

The tools container watches mounted source with polling. Native development
avoids mount-watcher overhead; the container workflow provides the same
application entry points. Your host computer still needs Node.js and pnpm to run
the package commands.
