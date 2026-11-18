FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build -w @az/shared && npm run build -w @az/web
FROM nginx:1.28-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
