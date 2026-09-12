# Development image only: Vite dev server with the source mounted.
# Build context is the repository root (see docker-compose.yml).
FROM node:22-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/rules/package.json ./packages/rules/
COPY apps/doctor/package.json ./apps/doctor/

RUN pnpm install --no-frozen-lockfile

COPY packages ./packages
COPY apps/doctor ./apps/doctor
# Design tokens live outside the app and are imported by src/main.tsx.
COPY design ./design

ENV NODE_ENV=development
# Bind mounts from Windows do not deliver inotify events reliably.
ENV VITE_USE_POLLING=true
EXPOSE 5173

CMD ["pnpm", "--filter", "@recetas/doctor", "dev"]
