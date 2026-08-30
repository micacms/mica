/**
 * @micacms/model is now @micacms/core.
 *
 * This package remains as a thin re-export for one release cycle, so a project
 * that imports the old name keeps building. Nothing lives here: depend on
 * `@micacms/core` and the extra hop disappears.
 */

export * from "@micacms/core";
