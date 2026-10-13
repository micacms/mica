import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

// One Astro collection for each Mica collection and settings page.
export const collections = micaCollections(site);
