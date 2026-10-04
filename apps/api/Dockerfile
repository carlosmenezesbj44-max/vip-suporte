FROM node:20-alpine AS build
WORKDIR /workspace
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build:shared && npm run prisma:generate && npm run build:api

FROM node:20-alpine AS production-deps
WORKDIR /workspace
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root=false

FROM node:20-alpine
WORKDIR /workspace
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=production-deps /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/apps/api ./apps/api
COPY --from=build /workspace/packages/shared ./packages/shared
EXPOSE 3333
CMD ["sh", "-c", "npm run prisma:migrate:deploy --workspace=apps/api && npm run start:prod --workspace=apps/api"]
