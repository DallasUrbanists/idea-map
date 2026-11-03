FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS build
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

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.output ./.output
USER node
CMD ["node", ".output/server/index.mjs"]
