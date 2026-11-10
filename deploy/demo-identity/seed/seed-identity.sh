#!/bin/sh
# Registers Mica with Pocket ID and creates the three demo people.
#
# Pocket ID generates the client secret when the client is created, and the
# subject of every person it creates, so none of them can be written into the
# Compose file. This creates them over the API and leaves them in the shared
# volume, where the CMS reads them at start.
#
# Pocket ID signs in with passkeys, so the demo people have no password. The
# script prints one sign-in link for each person instead. Open it, and then add
# a passkey in the account page to sign in again.
#
# Runs once. A second start finds oidc.env and stops. If a run fails, start
# again from nothing: `docker compose down -v`.
# `seed-identity.sh link <user>` prints a fresh sign-in link for a person.
#
# pipefail and `jq -e`: a refused API call must stop the seed, not write an empty value.
set -euo pipefail

env_file=/seed/oidc.env
api="$POCKET_ID_URL/api"

apk add --no-cache curl jq >/dev/null

call() {
  method=$1
  path=$2
  shift 2
  curl -sfS -X "$method" "$api$path" -H "X-API-KEY: $POCKET_ID_API_KEY" -H "Content-Type: application/json" "$@"
}

# A sign-in link for the person with this name and ID. It works once, within a day.
link() {
  token=$(call POST "/users/$2/one-time-access-token" -d '{"ttl":"24h"}' | jq -er .token)
  echo "  $1: $POCKET_ID_URL/lc/$token"
}

echo "seed: waiting for Pocket ID"
until curl -sf "$POCKET_ID_URL/.well-known/openid-configuration" >/dev/null; do sleep 2; done

if [ "${1:-}" = "link" ]; then
  name=${2:?usage: link <alice|bob|mallory>}
  id=$(call GET "/users?pagination%5Blimit%5D=100" | jq -er --arg name "$name" 'first(.data[] | select(.username == $name) | .id)') ||
    { echo "seed: no person called $name" >&2; exit 1; }
  link "$name" "$id"
  exit 0
fi

if [ -f "$env_file" ]; then
  echo "seed: Pocket ID is already set up"
  exit 0
fi

echo "seed: registering Mica"
# A confidential web client on the authorization code flow, which is the one
# Mica implements: PKCE, state and nonce, all verified.
client=$(call POST /oidc/clients -d "$(
  jq -n --arg callback "$CALLBACK_URL" '{
    id: "mica",
    name: "Mica",
    callbackURLs: [$callback],
    logoutCallbackURLs: [($callback | sub("/api/auth/callback$"; "/admin/"))],
    isPublic: false,
    pkceEnabled: true,
    skipConsent: true
  }'
)")

# Three people, chosen to make the outcomes visible. Mallory is the point:
# Pocket ID vouches for her and Mica turns her away, because she is not on the
# list of subjects the CMS was told to admit.
#
# Prints the subject Pocket ID assigned, which is what admission is keyed on. An
# email address would be the wrong key: a person can change it, and Mica would
# then be admitting whoever holds it next.
person() {
  call POST /users -d "$(
    jq -n --arg user "$1" --arg first "$2" --arg mail "$3" --argjson admin "$4" '{
      username: $user,
      firstName: $first,
      lastName: "Demo",
      email: $mail,
      emailVerified: true,
      isAdmin: $admin,
      disabled: false
    }'
  )" | jq -er .id
}

echo "seed: creating alice, bob and mallory"
# Alice may also open Pocket ID's own settings; being an administrator there has no meaning for Mica.
alice=$(person alice Alice alice@example.com true)
bob=$(person bob Bob bob@example.com false)
mallory=$(person mallory Mallory mallory@example.com false)

links=$(link alice "$alice"; link bob "$bob"; link mallory "$mallory")
secret=$(echo "$client" | jq -er .createdSecret.secret)

umask 022
{
  echo "MICA_OIDC_CLIENT_ID='mica'"
  echo "MICA_OIDC_CLIENT_SECRET='$secret'"
  # Who may edit. Mica has no user table and no invitation screen, so this is
  # the whole of authorization — two subjects, keyed by the issuer that made
  # them. A real deployment would normally use MICA_ADMIT_GROUPS against a
  # group its provider already manages.
  echo "MICA_ADMIT_SUBJECTS='$POCKET_ID_URL|$alice,$POCKET_ID_URL|$bob'"
} > "$env_file"

echo "seed: done — alice and bob may edit, mallory may not. Sign-in links, each for one sign-in within a day:"
echo "$links"
