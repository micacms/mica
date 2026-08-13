<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { ApiError } from "@/api";
import { useAuth } from "@/stores/auth";

const auth = useAuth();
const route = useRoute();
const router = useRouter();

const email = ref("");
const password = ref("");
const showPassword = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);

async function submit(): Promise<void> {
  error.value = null;
  busy.value = true;

  try {
    await auth.signIn(email.value, password.value);
    const redirect = route.query.redirect;
    await router.replace(typeof redirect === "string" ? redirect : { name: "dashboard" });
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : "Could not sign in. Please try again.";
    password.value = "";
    showPassword.value = false;
  } finally {
    busy.value = false;
  }
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

      <form class="card space-y-4 p-5" novalidate @submit.prevent="submit">
        <!-- role=alert so the failure is announced, not just displayed -->
        <p
          v-if="error"
          role="alert"
          class="rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger"
        >
          {{ error }}
        </p>

        <div>
          <label for="email" class="field-label">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            name="email"
            autocomplete="username"
            required
            autofocus
            :disabled="busy"
            class="input mt-1.5"
          />
        </div>

        <div>
          <label for="password" class="field-label">Password</label>
          <div class="relative mt-1.5">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              required
              :disabled="busy"
              class="input pr-10"
            />
            <!-- aria-pressed so the toggle state is announced, not just the icon swap -->
            <button
              type="button"
              class="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
              :aria-pressed="showPassword"
              aria-controls="password"
              :disabled="busy"
              @click="showPassword = !showPassword"
            >
              <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.75">
                <path
                  d="M1.75 10S4.75 4.75 10 4.75 18.25 10 18.25 10 15.25 15.25 10 15.25 1.75 10 1.75 10z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle cx="10" cy="10" r="2.25" />
                <path v-if="showPassword" d="M4 16L16 4" stroke-linecap="round" />
              </svg>
              <span class="sr-only">{{ showPassword ? "Hide password" : "Show password" }}</span>
            </button>
          </div>
        </div>

        <button type="submit" class="btn-primary w-full" :disabled="busy">
          {{ busy ? "Signing in…" : "Sign in" }}
        </button>
      </form>

      <p class="mt-4 text-center text-xs text-muted">
        Forgotten your password? Ask an administrator to set a new one.
      </p>
    </div>
  </div>
</template>
