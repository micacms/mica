import { createApp } from "vue";
import { config as zodConfig } from "zod";

import App from "@/App.vue";
import { router } from "@/router";
import { ApiError, messageOf, whenModelUnreadable, whenSessionExpiry, whenUnauthenticated, whenUnreachable } from "@/api";
import { applyColorScheme } from "@/composables/useColorScheme";
import { useConnection } from "@/stores/connection";
import { useSession } from "@/stores/session";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

import "@/style.css";

// The appearance this browser chose, before anything is drawn.
applyColorScheme();

// Zod tests once whether it may compile checks with `new Function`. The editor's CSP forbids that, and the test logs a violation.
zodConfig({ jitless: true });

const app = createApp(App);

// A 401 during work keeps the page and its unsaved changes; the shell offers to sign in again.
whenUnauthenticated(() => useSession().markEnded());
whenSessionExpiry((at) => useSession().noteExpiry(at));
// The change list carries the reason, and the notices by Save and Publish show it.
whenModelUnreadable(() => void useStaging().refresh());
// A failed request asks at once whether Mica still runs; the regular checks find a stop in an idle tab.
whenUnreachable(() => void useConnection().check());
useConnection().start();

/**
 * Anything that escapes a component's own handling lands here, and so does a
 * navigation that failed, such as a model that did not load: the next one
 * tries again. A 401 is the session's end, which the shell already shows.
 */
function report(error: unknown): void {
  if (error instanceof ApiError && error.isUnauthenticated) return;

  console.error(error);
  useToast().error(
    messageOf(error, "Something went wrong."),
    error instanceof Error && !(error instanceof ApiError) ? error.message : undefined,
  );
}

app.config.errorHandler = report;
router.onError(report);

app.use(router);
app.mount("#app");
