# The preview image of the test stack: the example website with its packages,
# from this repository, set up as micacms.com/docs/self-hosting/ tells a user to
# set up theirs. Only `content/` comes from Mica's volume, read-only.
FROM node:24-bookworm-slim

WORKDIR /repo
COPY . .
RUN node common/scripts/install-run-rush.js install --to @micacms/example-company-site \
 && node common/scripts/install-run-rush.js build --to @micacms/astro

WORKDIR /repo/examples/company-site
ENV MICA_PREVIEW=1
# The drafts: the content of Mica's clone, read-only, in place of the site's own, once the clone is there.
CMD ["sh", "-c", "until [ -d /mica/repository/content ]; do sleep 2; done; rm -rf content && ln -s /mica/repository/content content && exec node node_modules/astro/bin/astro.mjs dev --host 0.0.0.0 --port 4321"]
