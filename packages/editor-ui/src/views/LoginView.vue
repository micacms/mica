<script setup lang="ts">
/**
 * Sign in.
 *
 * There is no form. Mica does not hold passwords, so there is nothing for an
 * editor to type here — the button hands the browser to the identity provider,
 * which does the actual authenticating and sends it back.
 *
 * The error banner exists because the round trip can fail after the provider
 * is satisfied: someone can authenticate perfectly well and still not be
 * admitted to this site, and that has to read as "ask for access", not as
 * "your password was wrong".
 *
 * In local mode this screen is not reached at all: there is no provider, no
 * account and nobody to be, and the session starts as the page is served. The
 * redirect below is the fallback for the one way in that skips that — a
 * browser still holding `/admin/login` from an earlier session.
 */

import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { useSession } from "@/stores/session";

const session = useSession();
const route = useRoute();

const busy = ref(false);

/** Set by the callback when it bounces the browser back here with a reason. */
const error = ref<string | null>(null);

const provider = computed(() => session.config.value?.provider);
/** Local mode: no provider to send anybody to, so there is nothing to show. */
const authDisabled = computed(() => session.config.value?.authRequired === false);

/** Where to land afterwards. Always a path on this server. */
const returnTo = computed(() => {
  const redirect = route.query["redirect"];
  return typeof redirect === "string" && redirect.startsWith("/admin")
    ? redirect
    : "/admin/";
});

onMounted(() => {
  const reason = route.query["error"];
  if (typeof reason === "string") error.value = reason;

  // No provider, no question to ask. Straight to the editor.
  if (authDisabled.value && !error.value) signIn();
});

function signIn(): void {
  busy.value = true;
  session.signIn(returnTo.value);
}
</script>

<template>
  <!-- Local mode: a held breath, not a screen. -->
  <div v-if="authDisabled && !error" class="grid min-h-full place-items-center p-6">
    <p class="text-sm text-muted">Opening the editor…</p>
  </div>

  <div v-else class="grid min-h-full place-items-center p-6">
    <div class="w-full max-w-sm">
      <div class="mb-7 flex flex-col items-center gap-4 text-center">
        <img src="/brand/mica-logo-glimmer.svg" alt="Mica" class="h-10 w-auto" />
        <div>
          <h1 class="text-lg font-semibold tracking-tight">Sign in to Mica</h1>
          <p class="mt-0.5 text-sm text-muted">Manage your website content.</p>
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <p v-if="error" role="alert" class="rounded-md border border-danger/15 bg-danger-soft px-4 py-3 text-sm text-danger">
          {{ error }}
        </p>

        <button type="button" class="btn-primary w-full" :disabled="busy" @click="signIn">
          {{ busy ? "Redirecting…" : authDisabled ? "Continue" : "Sign in" }}
        </button>

        <p v-if="provider && !authDisabled" class="text-center text-xs text-muted">
          You will be taken to <span class="font-medium">{{ provider }}</span> to sign in.
        </p>
      </div>

      <p v-if="!authDisabled" class="mt-4 text-center text-xs text-muted">
        Mica does not hold your password. Trouble signing in is a question for
        whoever runs your identity provider; no access once you are in is a
        question for a site administrator.
      </p>
    </div>
  </div>
</template>
