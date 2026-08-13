/**
 * Astro content collections, generated from the shared model.
 *
 * This file is the whole integration. Everything the site renders comes from
 * the project's `mica.config.ts` and the content directory beside it, and the
 * pages use ordinary `getCollection` / `getEntry` — they never learn that a CMS
 * exists.
 *
 * The model import is direct and untransformed on purpose: `micaCollections`
 * reads the real model object, which is what gives `getCollection("projects")`
 * its field types with no code generation step.
 *
 * There is nothing to configure and nothing to reach: a build needs the
 * checkout it is already running in.
 */

import { micaCollections } from "@micacms/astro";

import site from "../../../mica.config";
import { CONTENT_ROOT } from "./content-root";

export const collections = micaCollections(site, { root: CONTENT_ROOT });
