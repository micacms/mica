# Mica CMS — API and administration SPA in one image.
#
# The public website is NOT built here: it is a static bundle produced by CI
# from the content repository and uploaded to whatever host the customer uses.
# This image is the CMS alone.
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
COPY packages/editor/package.json packages/editor/

RUN pnpm install --frozen-lockfile \
      --filter @micacms/editor... \
      --filter @micacms/core... \
      --filter @micacms/connectors...

# ---------------------------------------------------------------- build
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/connectors packages/connectors
COPY packages/editor packages/editor

# In dependency order: connectors imports core, the CMS imports both.
RUN pnpm --filter @micacms/core build \
 && pnpm --filter @micacms/connectors build \
 && pnpm --filter @micacms/editor build

# Re-resolve with dev dependencies pruned.
RUN pnpm install --frozen-lockfile --prod \
      --filter @micacms/editor... \
      --filter @micacms/core... \
      --filter @micacms/connectors...

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
# it. Only the database lives here — content is in the repository.
RUN mkdir -p /data && chown -R node:node /data

# pnpm keeps the real packages in the root `.pnpm` store and gives each
# workspace package a directory of relative symlinks into it. Every one of those
# directories has to come across, or a dependency resolves to nothing at
# runtime — `packages/core/node_modules` is where zod lives.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/core/package.json ./packages/core/
COPY --from=build --chown=node:node /app/packages/connectors/node_modules ./packages/connectors/node_modules
COPY --from=build --chown=node:node /app/packages/connectors/dist ./packages/connectors/dist
COPY --from=build --chown=node:node /app/packages/connectors/package.json ./packages/connectors/
COPY --from=build --chown=node:node /app/packages/editor/node_modules ./packages/editor/node_modules
COPY --from=build --chown=node:node /app/packages/editor/dist ./packages/editor/dist
COPY --from=build --chown=node:node /app/packages/editor/package.json ./packages/editor/

USER node
WORKDIR /app/packages/editor

VOLUME ["/data"]
EXPOSE 6422

# Reads from SQLite *and* reaches the content repository, so this detects a
# broken database or an unreachable repository — not merely a live event loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6422)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]
