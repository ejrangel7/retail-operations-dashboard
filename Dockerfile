FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS pnpm
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

FROM nginx:1.31-alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752 AS web-runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM pnpm AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter @retail-ops/api

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS api-runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=4000
COPY --from=production-dependencies --chown=node:node /workspace/node_modules /app/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/api/node_modules ./node_modules
COPY --chown=node:node apps/api/package.json ./package.json
COPY --from=api-build --chown=node:node /workspace/apps/api/dist ./dist
COPY --chown=node:node database/migrations /app/database/migrations
COPY --chown=node:node database/seeds/demo.sql /app/database/seeds/demo.sql
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

FROM api-runtime AS api-development
ENV NODE_ENV=development
COPY --chown=node:node database/local /app/database/local

FROM api-runtime AS runtime
ENV PORT=10000 STATIC_ASSETS_PATH=/app/public
COPY --from=web-build --chown=node:node /workspace/apps/web/dist /app/public
EXPOSE 10000
CMD ["node", "dist/server.js"]
