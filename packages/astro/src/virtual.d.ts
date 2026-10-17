/* Astro's virtual modules, as far as this package uses them. They resolve inside an Astro build only. */

declare module "astro:assets" {
  export const getImage: (options: unknown) => Promise<unknown>;
}

declare module "astro:content" {
  export const getEntry: (collection: string, id: string) => Promise<{ data: unknown } | undefined>;
}
