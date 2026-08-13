/**
 * Media reference registry.
 *
 * Forms bind to media *ids* — that is what gets stored — but a media field has
 * to show a thumbnail. The form provides this registry, seeded with the
 * references the server sent alongside the entry, and any field can resolve an
 * id or register newly uploaded files without prop-drilling.
 */

import { inject, provide, ref, type InjectionKey, type Ref } from "vue";

import type { MediaRef } from "@micacms/model";

export interface MediaRegistry {
  resolve(id: string): MediaRef | undefined;
  add(refs: MediaRef[]): void;
  all: Ref<Map<string, MediaRef>>;
}

const KEY: InjectionKey<MediaRegistry> = Symbol("mica.media");

export function provideMediaRegistry(initial: MediaRef[] = []): MediaRegistry {
  const all = ref(new Map(initial.map((item) => [item.id, item])));

  const registry: MediaRegistry = {
    all,
    resolve: (id) => all.value.get(id),
    add(refs) {
      const next = new Map(all.value);
      for (const item of refs) next.set(item.id, item);
      // Replace rather than mutate so template refs re-render.
      all.value = next;
    },
  };

  provide(KEY, registry);
  return registry;
}

export function useMediaRegistry(): MediaRegistry {
  const registry = inject(KEY, null);
  if (!registry) {
    throw new Error("A media field must be rendered inside a form that provides the registry.");
  }
  return registry;
}
