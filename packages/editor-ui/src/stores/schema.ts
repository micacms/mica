/**
 * The content model, fetched once per session.
 *
 * The admin ships no knowledge of any particular collection: navigation,
 * tables and forms are all generated from this. Adding a field to
 * `packages/model` therefore requires no change in this app.
 */

import { computed, ref } from "vue";

import { api, type Schema, type SchemaCollection, type SchemaReferenceSet, type SchemaSingleton } from "@/api";

const schema = ref<Schema | null>(null);
let inFlight: Promise<Schema> | null = null;

export function useSchema() {
  return {
    schema: computed(() => schema.value),
    collections: computed<SchemaCollection[]>(() => schema.value?.collections ?? []),
    singletons: computed<SchemaSingleton[]>(() => schema.value?.singletons ?? []),
    loaded: computed(() => schema.value !== null),

    /** Concurrent callers share one request. */
    async load(force = false): Promise<Schema> {
      if (schema.value && !force) return schema.value;
      inFlight ??= api.schema().then((result) => {
        schema.value = result;
        inFlight = null;
        return result;
      });
      return inFlight;
    },

    collection(name: string): SchemaCollection | undefined {
      return schema.value?.collections.find((item) => item.name === name);
    },

    singleton(name: string): SchemaSingleton | undefined {
      return schema.value?.singletons.find((item) => item.name === name);
    },

    reference(name: string): SchemaReferenceSet | undefined {
      return schema.value?.references?.find((item) => item.name === name);
    },

    reset(): void {
      schema.value = null;
      inFlight = null;
    },
  };
}
