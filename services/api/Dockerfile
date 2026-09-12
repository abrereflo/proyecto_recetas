# Development image only: source is mounted and tsx watches it.
# Build context is the repository root (see docker-compose.yml).
FROM node:22-alpine

RUN corepack enable

WORKDIR /app

# Manifests first so the install layer is cached independently of source edits.
COPY package.json pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/rules/package.json ./packages/rules/
COPY services/api/package.json ./services/api/

# No lockfile is committed yet; the first install writes one.
RUN pnpm install --no-frozen-lockfile

COPY packages ./packages
COPY services/api ./services/api

ENV NODE_ENV=development
EXPOSE 3000

CMD ["pnpm", "--filter", "@recetas/api", "dev"]
