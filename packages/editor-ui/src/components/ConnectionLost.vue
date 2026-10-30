<script setup lang="ts">
/**
 * Covers the whole editor while Mica does not answer, such as after
 * `mica start` stopped. The page underneath keeps its forms, and the cover
 * goes away by itself when Mica answers again.
 */

import { computed, ref, watch } from "vue";
import { Unplug } from "@lucide/vue";

import { useDialogFocus } from "@/composables/useDialogFocus";
import { useConnection } from "@/stores/connection";
import { useSession } from "@/stores/session";

const connection = useConnection();
const session = useSession();

const lost = computed(() => !connection.reachable.value);
// The local editor has no sign-in: there, the person who stopped Mica can start it again.
const local = computed(() => session.config.value?.authRequired === false);

// Before the focus goes back: an inert page cannot take it.
watch(lost, (isLost) => document.getElementById("app")?.toggleAttribute("inert", isLost));

const panel = ref<HTMLElement | null>(null);
const tryButton = ref<HTMLButtonElement | null>(null);
const { trapTab } = useDialogFocus(() => lost.value, panel, tryButton);

const checking = ref(false);
async function tryAgain(): Promise<void> {
  checking.value = true;
  try {
    await connection.check();
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="lost" class="fixed inset-0 z-60 grid place-items-center bg-ground/95 p-4 backdrop-blur-sm" @keydown="trapTab">
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="connection-lost-title"
        aria-describedby="connection-lost-body"
        class="w-full max-w-md rounded-xl border border-line bg-raised p-6 shadow-2xl"
      >
        <Unplug :size="24" class="text-muted" aria-hidden="true" />
        <h2 id="connection-lost-title" class="mt-3 text-base font-semibold">
          {{ local ? "Mica stopped" : "Mica is not reachable" }}
        </h2>

        <div id="connection-lost-body" class="mt-2 space-y-2 text-sm text-muted">
          <p v-if="local">
            Mica no longer runs on this computer, so your changes cannot be saved. To start it again, run
            <code class="font-mono text-ink">npx mica start</code> in your project.
          </p>
          <p v-else>Mica does not answer at the moment, so your changes cannot be saved. It tries again every few seconds.</p>
          <p>When Mica is back, this page continues where you left it. Your changes stay here until then.</p>
        </div>

        <div class="mt-5 flex justify-end">
          <button ref="tryButton" type="button" class="btn-secondary" :disabled="checking" @click="tryAgain">
            {{ checking ? "Checking…" : "Try again" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
