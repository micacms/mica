# Mica CMS — @micacms/self-hosted in one image: the runtime and the editor UI behind an
# external OIDC provider. CI builds the public website from the content repository, not here.
#
# No content model is baked in: the image reads `.mica/schema.json` from the content
# repository, so one published image serves any project and a content change needs no rebuild.

# ---------------------------------------------------------------- deps
# The base image is pinned by digest, in both stages, so that a build is
# repeatable; Dependabot moves both digests together.
#
# Install and build run on the build machine for every target platform: the
# server's dependencies are plain JavaScript, so their output is the same on
# amd64 and arm64. The build stage refuses a native module below.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS deps

WORKDIR /app

# Only the manifests, so a dependency install is cached until they change.
# Every project in rush.json must have one — Rush reads them all at startup,
# even for a filtered install — which is why the two site manifests and the
# browser test's are let through .dockerignore's exclusion of sites/, examples/
# and tests/.
COPY rush.json ./
COPY common ./common
COPY packages/core/package.json packages/core/
COPY packages/astro/package.json packages/astro/
COPY packages/runtime/package.json packages/runtime/
COPY packages/auth/oidc/package.json packages/auth/oidc/
COPY packages/editor-ui/package.json packages/editor-ui/
COPY apps/local-editor/package.json apps/local-editor/
COPY apps/self-hosted/package.json apps/self-hosted/
COPY sites/micacms/package.json sites/micacms/
COPY examples/muster-consulting/package.json examples/muster-consulting/
COPY tests/browser/package.json tests/browser/

# Installs only the closure the image needs. `rush install` never updates the committed lockfile.
RUN node common/scripts/install-run-rush.js install --to @micacms/self-hosted

# ---------------------------------------------------------------- build
FROM deps AS build

COPY tsconfig.base.json ./
COPY scripts/third-party-notices.mjs scripts/third-party-notices.d.mts scripts/
COPY packages/core packages/core
COPY packages/runtime packages/runtime
COPY packages/auth/oidc packages/auth/oidc
COPY packages/editor-ui packages/editor-ui
COPY apps/self-hosted apps/self-hosted

# With no .git in the build context, every project in the closure builds, not only changed ones.
RUN node common/scripts/install-run-rush.js build --to @micacms/self-hosted

# The app, its workspace dependencies and their production node_modules only, as
# common/config/rush/deploy.json sets. The editor UI's toolchain stays out of the runtime image.
RUN node common/scripts/install-run-rush.js deploy --overwrite --target-folder /deploy

# The licenses of the packages in the image require their notices beside them.
RUN node scripts/third-party-notices.mjs /deploy > /deploy/THIRD_PARTY_NOTICES.txt

# A native module would be built for the build machine, not for the target.
RUN if find /deploy -name '*.node' | grep .; then echo "A native module is in the image; build it per platform." >&2; exit 1; fi

# ---------------------------------------------------------------- runtime
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime

# tini reaps zombies and forwards SIGTERM, so the graceful shutdown runs. Git
# keeps the clone of the content repository that Mica edits and publishes. The
# package managers are not needed at run time, so they go.
RUN apk add --no-cache tini git \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    MICA_DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=6422

WORKDIR /app

# node:alpine ships an unprivileged `node` user; the volume must be writable by
# it. The clone lives here, and the unpublished drafts are files in it, so the
# volume is part of the backup story.
RUN mkdir -p /data && chown -R node:node /data

# The deploy folder mirrors the repository layout. Its node_modules are real
# directories plus symlinks into the pnpm store it carries; the symlinks are
# recreated here by the script `rush deploy` wrote next to the files, so
# nothing depends on Docker preserving link targets across COPY --from.
COPY --from=build --chown=node:node /deploy ./
RUN node create-links.js create

# The system software has its notices too: apk knows each package's license.
COPY scripts/licenses/GPL-2.0.txt /app/licenses/GPL-2.0.txt
RUN { printf '\n%s\n%s\n%s\n\n' \
      "System software in the image. Node.js is MIT, with the licenses of its bundled parts at" \
      "https://github.com/nodejs/node/blob/v24.x/LICENSE. The Alpine Linux packages and their licenses" \
      "follow; their sources are at https://gitlab.alpinelinux.org/alpine/aports, and the GPL-2.0 text is in /app/licenses/GPL-2.0.txt."; \
      apk list --installed; } >> /app/THIRD_PARTY_NOTICES.txt

USER node
WORKDIR /app/apps/self-hosted

VOLUME ["/data"]
EXPOSE 6422

# Liveness only: a repository outage must not restart a container that would
# not be any better for it. /ready is for a load balancer or a monitor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6422)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No arguments serves. `docker compose run --rm mica check` checks the
# configuration and the repository, then exits.
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
CMD []
