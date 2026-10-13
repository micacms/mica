<script setup lang="ts">
/**
 * What a pending change does, said as before and after.
 *
 * Not a diff: no line numbers, no `+`/`-`, no file contents. Each changed
 * field is one row with the stored value on the left and the staged one on
 * the right, worded by the field type — an editor who has never read a patch
 * can see exactly what publishing applies.
 */

import { computed } from "vue";

import type { FieldMap } from "@micacms/core";

import type { Comparison } from "@/api";
import { compareRows } from "@/lib/compare";

const props = withDefaults(
  defineProps<{
    comparison: Comparison;
    /** The owning document's fields; null for an order comparison. */
    fields: FieldMap | null;
    /** The visible names of the two sides. */
    labels?: { before: string; after: string };
  }>(),
  { labels: () => ({ before: "Before", after: "After" }) },
);

const mode = computed<"created" | "deleted" | "changed">(() => {
  if (props.comparison.before === null) return "created";
  if (props.comparison.after === null) return "deleted";
  return "changed";
});

const rows = computed(() =>
  props.fields
    ? compareRows(props.fields, props.comparison.before, props.comparison.after)
    : [],
);

/** An order comparison — the collection's sequence on both sides. */
interface OrderItem {
  slug: string;
  title: string;
}

const order = computed(() => {
  if (props.fields) return null;
  const side = (data: Record<string, unknown> | null): OrderItem[] =>
    Array.isArray(data?.["order"]) ? (data["order"] as OrderItem[]) : [];
  return { before: side(props.comparison.before), after: side(props.comparison.after) };
});

/** Slugs whose position changed, which is what an order change *is*. */
const moved = computed(() => {
  if (!order.value) return new Set<string>();
  const positions = new Map(order.value.before.map((item, index) => [item.slug, index]));
  return new Set(
    order.value.after
      .filter((item, index) => positions.get(item.slug) !== index)
      .map((item) => item.slug),
  );
});
</script>

<template>
  <div class="mt-3 rounded-md border border-line bg-canvas/60 p-3 text-xs">
    <p v-if="mode === 'created'" class="mb-2 font-medium text-success">
      New — publishing puts this on the site for the first time.
    </p>
    <p v-else-if="mode === 'deleted'" class="mb-2 font-medium text-danger">
      Publishing removes this from the site.
    </p>

    <!-- An order change: the sequence, before and after. -->
    <div v-if="order" class="grid grid-cols-2 gap-3">
      <div>
        <p class="mb-1.5 font-medium text-muted">Before</p>
        <ol class="list-decimal space-y-0.5 pl-5">
          <li
            v-for="item in order.before"
            :key="item.slug"
            :class="moved.has(item.slug) && 'font-medium text-ink'"
          >
            {{ item.title }}
          </li>
        </ol>
      </div>
      <div>
        <p class="mb-1.5 font-medium text-muted">After</p>
        <ol class="list-decimal space-y-0.5 pl-5">
          <li
            v-for="item in order.after"
            :key="item.slug"
            :class="moved.has(item.slug) && 'font-medium text-success'"
          >
            {{ item.title }}
          </li>
        </ol>
      </div>
    </div>

    <!-- Field changes. -->
    <template v-else>
      <p v-if="rows.length === 0" class="text-muted">
        Nothing visible changed — files moved or were rewritten without a field changing its value.
      </p>

      <dl v-else class="space-y-3">
        <div v-for="row in rows" :key="row.path">
          <dt class="mb-1 font-medium">
            <template v-for="(part, index) in row.label" :key="index">
              <span v-if="index > 0" class="text-muted" aria-hidden="true"> › </span
              ><span>{{ part }}</span>
            </template>
          </dt>
          <dd :class="['grid gap-2', mode === 'changed' ? 'grid-cols-2' : 'grid-cols-1']">
            <div
              v-if="mode !== 'created'"
              class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-danger/15 bg-danger-soft/60 p-2"
            >
              <span class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">{{ labels.before }}</span>{{ row.before }}
            </div>
            <div
              v-if="mode !== 'deleted'"
              class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-success/15 bg-success-soft/60 p-2"
            >
              <span class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">{{ labels.after }}</span>{{ row.after }}
            </div>
          </dd>
        </div>
      </dl>
    </template>
  </div>
</template>
