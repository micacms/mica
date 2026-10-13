import { createApp } from "vue";
import { config as zodConfig } from "zod";

import App from "@/App.vue";
import { router } from "@/router";
import { ApiError, whenSessionExpiry, whenUnauthenticated } from "@/api";
import { useSession } from "@/stores/session";
import { useToast } from "@/stores/toast";

import "@/style.css";

// Zod tests once whether it may compile checks with `new Function`. The editor's CSP forbids that, and the test logs a violation.
zodConfig({ jitless: true });

const app = createApp(App);

// A 401 during work keeps the page and its unsaved changes; the shell offers to sign in again.
whenUnauthenticated(() => useSession().markEnded());
whenSessionExpiry((at) => useSession().noteExpiry(at));

/**
 * Anything that escapes a component's own handling lands here. A 401 is the
 * session's end, which the shell already shows.
 */
app.config.errorHandler = (error) => {
  if (error instanceof ApiError && error.isUnauthenticated) return;

  console.error(error);
  useToast().error(
    error instanceof ApiError ? error.message : "Something went wrong.",
    error instanceof Error && !(error instanceof ApiError) ? error.message : undefined,
  );
};

app.use(router);
app.mount("#app");
