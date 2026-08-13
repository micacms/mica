<script setup lang="ts">
import { ref } from "vue";

import { api, ApiError } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { absoluteTime } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";

const auth = useAuth();
const toast = useToast();

const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function changePassword(): Promise<void> {
  error.value = null;

  if (newPassword.value !== confirmPassword.value) {
    error.value = "The new passwords do not match.";
    return;
  }

  busy.value = true;
  try {
    await api.auth.changePassword(currentPassword.value, newPassword.value);
    toast.success("Password changed.", "You have been signed out on all other devices.");
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    await auth.restore();
  } catch (caught) {
    error.value =
      caught instanceof ApiError ? caught.message : "Could not change your password.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHeader title="Your account" :subtitle="auth.user.value?.email" />

  <div class="mx-auto max-w-xl space-y-5 px-4 py-6 sm:px-6">
    <div
      v-if="auth.user.value?.mustChangePassword"
      role="alert"
      class="rounded-lg border border-warning/30 bg-warning/8 p-3.5 text-sm text-warning"
    >
      Your password was set by an administrator. Please choose your own below.
    </div>

    <section class="card p-5">
      <h2 class="text-sm font-semibold">Details</h2>
      <dl class="mt-3 space-y-1.5 text-sm">
        <div class="flex justify-between gap-4">
          <dt class="text-muted">Name</dt>
          <dd>{{ auth.user.value?.name || "—" }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">Email</dt>
          <dd>{{ auth.user.value?.email }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">Role</dt>
          <dd>{{ auth.user.value?.role === "admin" ? "Administrator" : "Editor" }}</dd>
        </div>
        <div v-if="auth.user.value?.lastLoginAt" class="flex justify-between gap-4">
          <dt class="text-muted">Last signed in</dt>
          <dd>{{ absoluteTime(auth.user.value.lastLoginAt) }}</dd>
        </div>
      </dl>

      <p class="mt-3 text-xs text-muted">
        Ask an administrator to change your name, email address or role.
      </p>
    </section>

    <section class="card p-5">
      <h2 class="text-sm font-semibold">Change password</h2>

      <form class="mt-3 space-y-3" novalidate @submit.prevent="changePassword">
        <p
          v-if="error"
          role="alert"
          class="rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger"
        >
          {{ error }}
        </p>

        <div>
          <label for="current-password" class="field-label">Current password</label>
          <input
            id="current-password"
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            class="input mt-1.5"
          />
        </div>

        <div>
          <label for="new-password" class="field-label">New password</label>
          <input
            id="new-password"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="10"
            required
            class="input mt-1.5"
          />
          <p class="field-hint">At least 10 characters. A short phrase works well.</p>
        </div>

        <div>
          <label for="confirm-password" class="field-label">Confirm new password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            class="input mt-1.5"
          />
        </div>

        <button type="submit" class="btn-primary" :disabled="busy">
          {{ busy ? "Changing…" : "Change password" }}
        </button>
      </form>
    </section>
  </div>
</template>
