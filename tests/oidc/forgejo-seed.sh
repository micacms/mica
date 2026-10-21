#!/bin/sh
# Seeds the test Forgejo: one user, one repository, the example content. The
# stack of tests/preview mounts a whole website at /seed-site instead.
#
# Runs once, in the Forgejo image, as Forgejo's own user and on Forgejo's data
# volume: the first user can only be made with the `forgejo admin` command,
# and the image already has Git and wget.
set -eu

API=http://localhost:3000/api/v1
USER=editor
AUTH=$(printf '%s:%s' "$USER" "$FORGEJO_PASSWORD" | base64)

until wget -qO- "$API/version" >/dev/null 2>&1; do sleep 1; done

forgejo admin user create --config /data/gitea/conf/app.ini \
  --username "$USER" --password "$FORGEJO_PASSWORD" --email editor@example.test \
  --must-change-password=false

wget -qO- --header "Authorization: Basic $AUTH" --header "Content-Type: application/json" \
  --post-data '{"name":"site","default_branch":"main","private":true}' "$API/user/repos" >/dev/null

export HOME=/tmp
mkdir -p /tmp/site
if [ -d /seed-site ]; then cp -R /seed-site/. /tmp/site/; else cp -R /seed /tmp/site/content; fi
# The example content has no PNG files, so this gives only new ones to Git LFS.
printf '*.png filter=lfs diff=lfs merge=lfs -text\n' > /tmp/site/content/.gitattributes
cd /tmp/site
git init --quiet -b main
git add -A
git -c user.name=Seed -c user.email=seed@example.test commit --quiet -m "Seed the example content"
git push --quiet "http://$USER:$FORGEJO_PASSWORD@localhost:3000/$USER/site.git" main

echo "Seeded $USER/site"
