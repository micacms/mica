# Mica CMS — the self-hosted composition in one image.
#
# The public website is NOT built here: it is a static bundle produced by CI
# from the content repository and uploaded to whatever host the customer uses.
# This image is the CMS alone: @micacms/self-hosted, composing the runtime and
# the editor UI behind an external OIDC provider.
#
# Nor is any content model baked in. The image knows the *field types* — it
# carries `@micacms/core` for validation — but it knows no collections until it
# reads the model out of the content repository, at `.mica/schema.json`. That is
# what makes one published image serve any project instead of one image per
# customer, and why a content change never needs a rebuild.

# ---------------------------------------------------------------- deps
FROM node:24-alpine AS deps

RUN corepack enable
WORKDIR /app

# pnpm asks for confirmation before purging node_modules (which the --prod
# re-resolve below does) and aborts without a TTY. This is that confirmation.
ENV CI=true

# Only the manifests, so a dependency install is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/connectors/package.json packages/connectors/
COPY packages/runtime/package.json packages/runtime/
COPY packages/auth/oidc/package.json packages/auth/oidc/
COPY packages/editor-ui/package.json packages/editor-ui/
COPY apps/self-hosted/package.json apps/self-hosted/

RUN pnpm install --frozen-lockfile \
      --filter @micacms/self-hosted... \
      --filter @micacms/editor-ui...

# ---------------------------------------------------------------- build
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/connectors packages/connectors
COPY packages/runtime packages/runtime
COPY packages/auth/oidc packages/auth/oidc
COPY packages/editor-ui packages/editor-ui
COPY apps/self-hosted apps/self-hosted

# In dependency order: connectors and runtime import core, auth imports the
# runtime, the app composes all of them, and the UI builds on its own.
RUN pnpm --filter @micacms/core build \
 && pnpm --filter @micacms/connectors build \
 && pnpm --filter @micacms/runtime build \
 && pnpm --filter @micacms/auth-oidc build \
 && pnpm --filter @micacms/editor-ui build \
 && pnpm --filter @micacms/self-hosted build

# Re-resolve with dev dependencies pruned. The editor UI is finished assets by
# now, so its toolchain does not survive into the runtime image.
RUN pnpm install --frozen-lockfile --prod \
      --filter @micacms/self-hosted...

# ---------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime

# tini reaps zombies and forwards SIGTERM, so the graceful shutdown that closes
# SQLite actually runs.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=6422

WORKDIR /app

# node:alpine ships an unprivileged `node` user; the volume must be writable by
# it. The database lives here — sessions, and the draft store behind a provider
# repository — so the volume is part of the backup story now.
RUN mkdir -p /data && chown -R node:node /data

# pnpm keeps the real packages in the root `.pnpm` store and gives each
# workspace package a directory of relative symlinks into it. Every one of
# those directories has to come across, or a dependency resolves to nothing at
# runtime — `packages/core/node_modules` is where zod lives.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/core/package.json ./packages/core/
COPY --from=build --chown=node:node /app/packages/connectors/node_modules ./packages/connectors/node_modules
COPY --from=build --chown=node:node /app/packages/connectors/dist ./packages/connectors/dist
COPY --from=build --chown=node:node /app/packages/connectors/package.json ./packages/connectors/
COPY --from=build --chown=node:node /app/packages/runtime/node_modules ./packages/runtime/node_modules
COPY --from=build --chown=node:node /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=build --chown=node:node /app/packages/runtime/package.json ./packages/runtime/
COPY --from=build --chown=node:node /app/packages/auth/oidc/node_modules ./packages/auth/oidc/node_modules
COPY --from=build --chown=node:node /app/packages/auth/oidc/dist ./packages/auth/oidc/dist
COPY --from=build --chown=node:node /app/packages/auth/oidc/package.json ./packages/auth/oidc/
COPY --from=build --chown=node:node /app/packages/editor-ui/dist ./packages/editor-ui/dist
COPY --from=build --chown=node:node /app/packages/editor-ui/package.json ./packages/editor-ui/
COPY --from=build --chown=node:node /app/apps/self-hosted/node_modules ./apps/self-hosted/node_modules
COPY --from=build --chown=node:node /app/apps/self-hosted/dist ./apps/self-hosted/dist
COPY --from=build --chown=node:node /app/apps/self-hosted/package.json ./apps/self-hosted/

USER node
WORKDIR /app/apps/self-hosted

VOLUME ["/data"]
EXPOSE 6422

# Reads from SQLite *and* reaches the content repository, so this detects a
# broken database or an unreachable repository — not merely a live event loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6422)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
