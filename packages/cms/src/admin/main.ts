import { createApp } from "vue";

import App from "@/App.vue";
import { router } from "@/router";
import { ApiError } from "@/api";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";

import "@/style.css";

const app = createApp(App);

/**
 * Anything that escapes a component's own handling lands here. A 401 means the
 * session ended mid-session, which is a redirect rather than an error message.
 */
app.config.errorHandler = (error) => {
  if (error instanceof ApiError && error.isUnauthenticated) {
    useAuth().clear();
    void router.push({ name: "login" });
    return;
  }

  console.error(error);
  useToast().error(
    error instanceof ApiError ? error.message : "Something went wrong.",
    error instanceof Error && !(error instanceof ApiError) ? error.message : undefined,
  );
};

app.use(router);
app.mount("#app");
