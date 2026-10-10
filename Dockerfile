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

WORKDIR /app

# Only the manifests, so a dependency install is cached until they change.
# Every project in rush.json must have one — Rush reads them all at startup,
# even for a filtered install — which is why the two site manifests and the
# browser test's are let through .dockerignore's exclusion of sites/, examples/
# and tests/.
COPY rush.json ./
COPY common ./common
COPY packages/core/package.json packages/core/
COPY packages/connectors/package.json packages/connectors/
COPY packages/astro/package.json packages/astro/
COPY packages/runtime/package.json packages/runtime/
COPY packages/auth/oidc/package.json packages/auth/oidc/
COPY packages/editor-ui/package.json packages/editor-ui/
COPY apps/local-editor/package.json apps/local-editor/
COPY apps/self-hosted/package.json apps/self-hosted/
COPY sites/micacms/package.json sites/micacms/
COPY examples/muster-consulting/package.json examples/muster-consulting/
COPY tests/browser/package.json tests/browser/

# install-run-rush bootstraps the Rush version rush.json pins, then installs
# only the closure the image needs. `rush install` is frozen by definition: it
# refuses rather than update the committed lockfile.
RUN node common/scripts/install-run-rush.js install --to @micacms/self-hosted

# ---------------------------------------------------------------- build
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/connectors packages/connectors
COPY packages/runtime packages/runtime
COPY packages/auth/oidc packages/auth/oidc
COPY packages/editor-ui packages/editor-ui
COPY apps/self-hosted apps/self-hosted

# Rush knows the dependency order; `--to` builds the app's closure and nothing
# else. (No .git in the build context, so every project builds — there is no
# history for the incremental analysis to compare against.)
RUN node common/scripts/install-run-rush.js build --to @micacms/self-hosted

# Assemble the runtime tree: the app, its workspace dependencies, and their
# production node_modules only — common/config/rush/deploy.json is the
# scenario. This replaces the old `pnpm install --prod` re-resolve; the editor
# UI is finished assets by now, so its toolchain does not survive into the
# runtime image.
RUN node common/scripts/install-run-rush.js deploy --overwrite --target-folder /deploy

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
# it. The draft store lives here, so the volume is part of the backup story.
RUN mkdir -p /data && chown -R node:node /data

# The deploy folder mirrors the repository layout. Its node_modules are real
# directories plus symlinks into the pnpm store it carries; the symlinks are
# recreated here by the script `rush deploy` wrote next to the files, so
# nothing depends on Docker preserving link targets across COPY --from.
COPY --from=build --chown=node:node /deploy ./
RUN node create-links.js create

USER node
WORKDIR /app/apps/self-hosted

VOLUME ["/data"]
EXPOSE 6422

# Reaches the content repository, and the database, so this
# detects a broken store — not merely a live event loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6422)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
