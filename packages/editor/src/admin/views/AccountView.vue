<script setup lang="ts">
/**
 * Your account.
 *
 * Read-only, because none of it is Mica's to change. The name and email come
 * from the identity provider and are refreshed at every sign-in; the role comes
 * from a membership an administrator controls. There is no password section
 * because there is no password.
 */

import { computed } from "vue";

import PageHeader from "@/components/PageHeader.vue";
import { absoluteTime } from "@/lib/format";
import { useAuth } from "@/stores/auth";

const auth = useAuth();

const provider = computed(() => auth.config.value?.provider);
const authDisabled = computed(() => auth.config.value?.authDisabled ?? false);
</script>

<template>
  <PageHeader title="Your account" :subtitle="auth.user.value?.email" />

  <div class="mx-auto max-w-xl space-y-5 px-4 py-6 sm:px-6">
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
        A site administrator sets your role. Everything else comes from your
        identity provider.
      </p>
    </section>

    <section class="card p-5">
      <h2 class="text-sm font-semibold">Sign-in</h2>

      <p v-if="authDisabled" class="mt-2 text-sm text-muted">
        This deployment runs in local mode with authentication disabled. There is
        no account to manage.
      </p>

      <template v-else>
        <p class="mt-2 text-sm text-muted">
          You sign in through
          <span class="font-medium">{{ provider ?? "your identity provider" }}</span>. Mica never
          sees your password, so there is nothing to change here — your name,
          your email address, your password and any second factor are all
          managed there.
        </p>

        <button type="button" class="btn-secondary mt-3" @click="auth.signOut()">
          Sign out
        </button>
      </template>
    </section>
  </div>
</template>
