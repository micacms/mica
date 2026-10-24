// @ts-check
import { defineConfig } from "astro/config";
import { micaPreview } from "@micacms/astro/preview";

// The collections are in src/content.config.ts. micaPreview() lets a click on a
// text in the editor's live preview open its field, in `npm run mica` only.
export default defineConfig({
  integrations: [micaPreview()],
});
