FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS pnpm
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM pnpm AS build-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM build-dependencies AS api-build
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN pnpm --filter @retail-ops/api build

FROM build-dependencies AS web-build
COPY apps/web ./apps/web
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @retail-ops/web build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS web-runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM pnpm AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter @retail-ops/api

FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS api-runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=4000 DATABASE_INIT_PATH=/app/database/init.sql
COPY --from=production-dependencies --chown=node:node /workspace/node_modules /app/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/api/node_modules ./node_modules
COPY --chown=node:node apps/api/package.json ./package.json
COPY --from=api-build --chown=node:node /workspace/apps/api/dist ./dist
COPY --chown=node:node database/init.sql /app/database/init.sql
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

FROM api-runtime AS api-development
ENV NODE_ENV=development DATABASE_DEVELOPMENT_SEED_PATH=/app/database/local-operator.sql
COPY --chown=node:node database/local-operator.sql /app/database/local-operator.sql

FROM api-runtime AS runtime
ENV PORT=10000 STATIC_ASSETS_PATH=/app/public
COPY --from=web-build --chown=node:node /workspace/apps/web/dist /app/public
EXPOSE 10000
CMD ["node", "dist/server.js"]
