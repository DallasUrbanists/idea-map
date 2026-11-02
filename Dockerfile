FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
WORKDIR /app
RUN --mount=type=secret,id=proxy_ca \
    export NODE_USE_ENV_PROXY=1 \
    && if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi \
    && corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    export NODE_USE_ENV_PROXY=1 \
    && if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi \
    && pnpm install --frozen-lockfile && pnpm build

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.output ./.output
USER node
CMD ["node", ".output/server/index.mjs"]
