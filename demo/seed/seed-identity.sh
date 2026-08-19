#!/bin/sh
# Registers Mica with ZITADEL and creates the three demo people.
#
# ZITADEL generates the client id and secret when the application is created,
# and the subject of every person it creates, so none of them can be written
# into the Compose file. This creates them over the API and leaves them in the
# shared volume, where the CMS reads them at start.
#
# Runs once. A second start finds oidc.env and stops.
set -eu

env_file=/seed/oidc.env
pat_file=/seed/zitadel.pat

if [ -f "$env_file" ]; then
  echo "seed: ZITADEL is already set up"
  exit 0
fi

apk add --no-cache curl jq >/dev/null

echo "seed: waiting for ZITADEL"
while [ ! -f "$pat_file" ]; do sleep 2; done
until curl -sf "$ZITADEL_URL/debug/ready" >/dev/null; do sleep 2; done

auth="Authorization: Bearer $(cat "$pat_file")"
api="$ZITADEL_URL/management/v1"

post() {
  curl -sfS -X POST "$api/$1" -H "$auth" -H "Content-Type: application/json" -d "$2"
}

echo "seed: registering Mica"
project=$(post projects '{"name":"Mica"}' | jq -r .id)

# A confidential web client on the authorization code flow, which is the one
# Mica implements: PKCE, state and nonce, all verified.
app=$(post "projects/$project/apps/oidc" "$(
  jq -n --arg callback "$CALLBACK_URL" '{
    name: "Mica CMS",
    appType: "OIDC_APP_TYPE_WEB",
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
    authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
    accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
    redirectUris: [$callback],
    postLogoutRedirectUris: [$callback | sub("/api/auth/callback$"; "/admin/")],
    devMode: true
  }'
)")

# Three people, chosen to make the outcomes visible. Mallory is the point:
# ZITADEL vouches for her and Mica turns her away, because she is not on the
# list of subjects the CMS was told to admit.
#
# Prints the subject ZITADEL assigned, which is what admission is keyed on. An
# email address would be the wrong key: ZITADEL lets a person change theirs,
# and Mica would then be admitting whoever holds it next.
person() {
  post users/human/_import "$(
    jq -n --arg user "$1" --arg first "$2" --arg mail "$3" --arg password "$4" '{
      userName: $user,
      profile: { firstName: $first, lastName: "Demo" },
      email: { email: $mail, isEmailVerified: true },
      password: $password,
      passwordChangeRequired: false
    }'
  )" | jq -r .userId
}

echo "seed: creating alice, bob and mallory"
alice=$(person alice Alice alice@example.com Alice-Demo1)
bob=$(person bob Bob bob@example.com Bob-Demo1)
person mallory Mallory mallory@example.com Mallory-Demo1 >/dev/null

umask 022
{
  echo "MICA_OIDC_CLIENT_ID='$(echo "$app" | jq -r .clientId)'"
  echo "MICA_OIDC_CLIENT_SECRET='$(echo "$app" | jq -r .clientSecret)'"
  # Who may edit. Mica has no user table and no invitation screen, so this is
  # the whole of authorization — two subjects, keyed by the issuer that made
  # them. A real deployment would normally use MICA_ADMIT_GROUP against a
  # group its provider already manages.
  echo "MICA_ADMIT_SUBJECTS='$ZITADEL_URL|$alice,$ZITADEL_URL|$bob'"
} > "$env_file"

echo "seed: done — alice and bob may edit, mallory may not"
