<script setup lang="ts">
/**
 * Sign in.
 *
 * There is no form. Mica does not hold passwords, so there is nothing for an
 * editor to type here — the button hands the browser to the identity provider,
 * which does the actual authenticating and sends it back.
 *
 * The error banner exists because the round trip can fail after the provider
 * is satisfied: someone can authenticate perfectly well and still have no
 * membership on this site, and that has to read as "ask for access", not as
 * "your password was wrong".
 */

import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { useAuth } from "@/stores/auth";

const auth = useAuth();
const route = useRoute();

const busy = ref(false);

/** Set by the callback when it bounces the browser back here with a reason. */
const error = ref<string | null>(null);

const provider = computed(() => auth.config.value?.provider);
const authDisabled = computed(() => auth.config.value?.authDisabled ?? false);

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
});

function signIn(): void {
  busy.value = true;
  auth.signIn(returnTo.value);
}
</script>

<template>
  <div class="grid min-h-full place-items-center p-6">
    <div class="w-full max-w-sm">
      <div class="mb-7 flex flex-col items-center gap-3 text-center">
        <svg viewBox="0 0 32 32" class="h-11 w-11" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
          <path
            d="M8 22V10l8 7 8-7v12"
            stroke="#fff"
            stroke-width="2.5"
            fill="none"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <div>
          <h1 class="text-lg font-semibold tracking-tight">Sign in to Mica</h1>
          <p class="mt-0.5 text-sm text-muted">Manage your website content.</p>
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <p v-if="error" role="alert" class="rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger">
          {{ error }}
        </p>

        <!-- Local mode is worth saying out loud. A developer who forgets which
             mode they are in should not discover it from an audit. -->
        <p
          v-if="authDisabled"
          class="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <strong>Authentication is disabled.</strong>
          This deployment runs in local mode, so anyone reaching this page is
          signed in as the developer account.
        </p>

        <button type="button" class="btn-primary w-full" :disabled="busy" @click="signIn">
          {{
            busy
              ? "Redirecting…"
              : authDisabled
                ? "Continue as developer"
                : "Sign in"
          }}
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
