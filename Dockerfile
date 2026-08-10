FROM node:22-alpine AS api-build
WORKDIR /build/api
COPY apps/api/package.json ./
RUN npm install
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

FROM node:22-alpine AS web-build
WORKDIR /build/web
COPY apps/web/package.json ./
RUN npm install
COPY apps/web ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=10000 STATIC_ASSETS_PATH=/app/public DATABASE_INIT_PATH=/app/database/init.sql
COPY apps/api/package.json ./
RUN npm install --omit=dev
COPY --from=api-build /build/api/dist ./dist
COPY --from=web-build /build/web/dist ./public
COPY database/init.sql ./database/init.sql
EXPOSE 10000
CMD ["npm", "start"]
