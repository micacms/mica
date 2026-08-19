<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

import AppShell from "@/components/AppShell.vue";
import ToastStack from "@/components/ToastStack.vue";
import { useSession } from "@/stores/session";

const route = useRoute();
const session = useSession();

// The sign-in view has no navigation around it.
const chrome = computed(() => session.isActive.value && !route.meta.public);
</script>

<template>
  <ToastStack />

  <AppShell v-if="chrome">
    <RouterView v-slot="{ Component, route: current }">
      <component :is="Component" :key="current.fullPath" />
    </RouterView>
  </AppShell>

  <RouterView v-else />
</template>
