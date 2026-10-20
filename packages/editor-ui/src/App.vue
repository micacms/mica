<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from "vue-router";

import AppShell from "@/components/AppShell.vue";
import ToastStack from "@/components/ToastStack.vue";
import { withoutOverlay } from "@/lib/overlay-address";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const session = useSession();

/** The view's key: its address without `overlay`, which opens and closes the overlay form over it. */
function viewKey(location: RouteLocationNormalizedLoaded): string {
  return router.resolve({ path: location.path, query: withoutOverlay(location.query), hash: location.hash }).fullPath;
}

// The sign-in view has no navigation around it.
const chrome = computed(() => session.isActive.value && !route.meta.public);
</script>

<template>
  <ToastStack />

  <AppShell v-if="chrome">
    <RouterView v-slot="{ Component, route: current }">
      <!-- A new address mounts the view again: a view loads in onMounted and watches no route prop. The overlay form is not the view's. -->
      <component :is="Component" :key="viewKey(current)" />
    </RouterView>
  </AppShell>

  <RouterView v-else />
</template>
