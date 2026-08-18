<script setup lang="ts">
/**
 * System information.
 *
 * What is running, what content model it was handed, and how much content
 * there is — the questions that otherwise need shell access to the container.
 * Read-only except for "Copy report", which puts the whole thing on the
 * clipboard in the shape a bug report wants.
 *
 * Nothing here is per customer: the model section is generated from whatever
 * model the server was given, exactly like the rest of the admin.
 */

import { computed, onMounted, ref } from "vue";
import { ArrowRight } from "@lucide/vue";

import { api, ApiError, type SystemInfo } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { absoluteTime, formatBytes, formatDuration } from "@/lib/format";
import { useToast } from "@/stores/toast";

const toast = useToast();

const info = ref<SystemInfo | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    info.value = await api.system();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the system information.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/**
 * `richText` → "Rich text". Derived rather than a table, so a field kind added
 * to the model reads correctly here without a second edit — the initialisms are
 * the only thing splitting on case cannot get right.
 */
const INITIALISMS: Record<string, string> = { url: "URL" };

function kindLabel(kind: string): string {
  if (INITIALISMS[kind]) return INITIALISMS[kind];
  const words = kind.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const busiestKind = computed(() =>
  Math.max(1, ...(info.value?.schema.kinds ?? []).map((item) => item.count)),
);

const labels = computed(() => {
  const map = new Map<string, string>();
  for (const item of info.value?.schema.collections ?? []) map.set(`collection:${item.name}`, item.label);
  for (const item of info.value?.schema.singletons ?? []) {
    map.set(`singleton:${item.name}`, item.label);
  }
  return map;
});

function collectionLabel(name: string): string {
  return labels.value.get(`collection:${name}`) ?? name;
}

/** The report a support request should carry, as plain text. */
function report(): string {
  const data = info.value;
  if (!data) return "";

  const lines = [
    `Mica ${data.cms.version} (${data.cms.environment})`,
    `Node ${data.cms.node} on ${data.cms.platform}, up ${formatDuration(data.cms.uptimeSeconds)}`,
    `Schema — ${data.schema.totals.collections} collections, ` +
      `${data.schema.totals.singletons} singletons, ${data.schema.totals.total} fields`,
    `Repository ${data.repository.origin}`,
    `Repository holds ${data.repository.entries} entries and ` +
      `${data.repository.media.files} media files (${data.repository.media.readable})`,
    `Database: ${data.database.users} users, migration ${data.database.version}, ` +
      `${data.database.bytes === null ? "size unknown" : formatBytes(data.database.bytes)}`,
  ];

  if (data.deployment) {
    lines.push(
      `Base URL ${data.deployment.baseUrl}`,
      `Content model ${data.deployment.schemaOrigin}`,
      `Content root ${data.deployment.contentRoot}`,
      `Data directory ${data.deployment.dataDir}`,
    );
  }

  return lines.join("\n");
}

async function copyReport(): Promise<void> {
  try {
    // Absent on an insecure origin, which a self-hosted CMS may well be.
    await navigator.clipboard.writeText(report());
    toast.success("Report copied to the clipboard.");
  } catch {
    toast.error("Could not copy. Select the values you need instead.");
  }
}
</script>

<template>
  <PageHeader
    title="System"
    :subtitle="info ? `Mica ${info.cms.version} · ${info.cms.environment}` : null"
  >
    <button type="button" class="btn-ghost" :disabled="loading" @click="load">Refresh</button>
    <button type="button" class="btn-secondary" :disabled="!info" @click="copyReport">
      Copy report
    </button>
  </PageHeader>

  <div class="mx-auto max-w-5xl space-y-6 px-4 py-5 pb-12 sm:px-6">
    <p v-if="loading" class="text-sm text-muted">Loading…</p>

    <template v-else-if="info">
      <!-- ------------------------------------------------------ at a glance -->

      <section aria-labelledby="glance-heading">
        <h2 id="glance-heading" class="sr-only">At a glance</h2>

        <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="card p-4">
            <dt class="text-sm text-muted">Version</dt>
            <dd class="mt-1 text-2xl font-semibold tabular-nums">{{ info.cms.version }}</dd>
            <dd class="mt-1 text-xs text-muted">{{ info.cms.environment }}</dd>
          </div>

          <div class="card p-4">
            <dt class="text-sm text-muted">Uptime</dt>
            <dd class="mt-1 text-2xl font-semibold tabular-nums">
              {{ formatDuration(info.cms.uptimeSeconds) }}
            </dd>
            <dd class="mt-1 text-xs text-muted">
              <!-- Absolute, not relative: "up 1 min, since 1 minute ago" says
                   the same thing twice, and the start time is the useful half. -->
              <time :datetime="info.cms.startedAt">{{ absoluteTime(info.cms.startedAt) }}</time>
            </dd>
          </div>

          <div class="card p-4">
            <dt class="text-sm text-muted">Content model</dt>
            <dd class="mt-1 text-2xl font-semibold tabular-nums">
              {{ info.schema.totals.total }}
            </dd>
            <dd class="mt-1 text-xs text-muted">
              fields in {{ info.schema.totals.collections }} collections,
              {{ info.schema.totals.singletons }} singletons
            </dd>
          </div>

          <div class="card p-4">
            <dt class="text-sm text-muted">In the repository</dt>
            <dd class="mt-1 text-2xl font-semibold tabular-nums">
              {{ info.repository.entries }}
            </dd>
            <dd class="mt-1 text-xs text-muted">
              entries · {{ info.repository.media.files }} media files
            </dd>
          </div>
        </dl>
      </section>

      <!-- --------------------------------------------------- content model -->

      <section class="card p-4" aria-labelledby="model-heading">
        <h2 id="model-heading" class="text-sm font-semibold">Content model</h2>
        <p class="mt-1 text-xs text-muted">
          The schema this server was handed at startup. The same file describes the model to the
          Astro build, so the editor and the website cannot disagree about it.
        </p>

        <dl class="spec mt-3">
          <div>
            <dt>Required fields</dt>
            <dd class="tabular-nums">
              {{ info.schema.totals.required }} of {{ info.schema.totals.total }}
            </dd>
          </div>
        </dl>

        <h3 class="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Field types</h3>
        <ul class="mt-2 space-y-1.5">
          <li v-for="item in info.schema.kinds" :key="item.kind" class="flex items-center gap-3 text-sm">
            <span class="w-28 shrink-0 truncate">{{ kindLabel(item.kind) }}</span>
            <span class="h-1.5 min-w-0 flex-1 rounded-full bg-canvas" aria-hidden="true">
              <span
                class="block h-full rounded-full bg-brand/60"
                :style="{ width: `${(item.count / busiestKind) * 100}%` }"
              />
            </span>
            <span class="w-8 shrink-0 text-right text-xs tabular-nums text-muted">
              {{ item.count }}
            </span>
          </li>
        </ul>
      </section>

      <!-- ---------------------------------------------------- collections -->

      <section class="card overflow-hidden" aria-labelledby="collections-heading">
        <h2 id="collections-heading" class="border-b border-line px-4 py-3 text-sm font-semibold">
          Collections
        </h2>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">Collections in the content model, with their entry counts</caption>
            <thead>
              <tr class="border-b border-line text-left text-xs text-muted">
                <th scope="col" class="px-4 py-2 font-medium">Collection</th>
                <th scope="col" class="px-4 py-2 text-right font-medium">Entries</th>
                <th scope="col" class="px-4 py-2 text-right font-medium">Fields</th>
                <th scope="col" class="hidden px-4 py-2 font-medium sm:table-cell">Title / slug</th>
                <th scope="col" class="hidden px-4 py-2 font-medium sm:table-cell">Ordering</th>
              </tr>
            </thead>

            <tbody class="divide-y divide-line">
              <tr v-for="item in info.schema.collections" :key="item.name">
                <td class="px-4 py-2.5">
                  <RouterLink
                    :to="{ name: 'collection', params: { collection: item.name } }"
                    class="font-medium hover:text-brand"
                  >
                    {{ item.label }}
                  </RouterLink>
                  <span class="mono block text-muted">{{ item.name }}</span>
                </td>

                <td class="px-4 py-2.5 text-right tabular-nums">{{ item.entries }}</td>

                <td class="px-4 py-2.5 text-right tabular-nums">
                  {{ item.fields.top }}
                  <span v-if="item.fields.total > item.fields.top" class="block text-xs text-muted">
                    {{ item.fields.total }} with nested
                  </span>
                </td>

                <td class="mono hidden px-4 py-2.5 text-muted sm:table-cell">
                  {{ item.titleField ?? "—" }} / {{ item.slugField ?? "—" }}
                </td>

                <td class="hidden px-4 py-2.5 text-xs text-muted sm:table-cell">
                  {{ item.sortable ? "Manual" : "Automatic" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ----------------------------------------------------- singletons -->

      <section
        v-if="info.schema.singletons.length"
        class="card p-4"
        aria-labelledby="singletons-heading"
      >
        <h2 id="singletons-heading" class="text-sm font-semibold">Singletons</h2>

        <dl class="spec mt-3">
          <div v-for="item in info.schema.singletons" :key="item.name">
            <dt>
              <RouterLink
                :to="{ name: 'singleton', params: { name: item.name } }"
                class="hover:text-brand"
              >
                {{ item.label }}
              </RouterLink>
            </dt>
            <dd class="tabular-nums">
              {{ item.fields.top }} field{{ item.fields.top === 1 ? "" : "s" }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- ------------------------------------------------------ relations -->

      <section v-if="info.schema.relations.length" class="card p-4" aria-labelledby="relations-heading">
        <h2 id="relations-heading" class="text-sm font-semibold">Relations</h2>
        <p class="mt-1 text-xs text-muted">
          Deleting an entry that is referenced here is warned about before it happens.
        </p>

        <ul class="mt-3 space-y-1.5 text-sm">
          <li
            v-for="edge in info.schema.relations"
            :key="`${edge.fromType}:${edge.from}.${edge.path}`"
            class="flex flex-wrap items-baseline gap-x-2"
          >
            <span class="font-medium">
              {{ labels.get(`${edge.fromType}:${edge.from}`) ?? edge.from }}
            </span>
            <span class="mono text-muted">{{ edge.path }}</span>
            <ArrowRight :size="14" class="text-muted" aria-hidden="true" />
            <span>{{ collectionLabel(edge.to) }}</span>
            <span v-if="edge.multiple" class="badge bg-brand-soft text-brand">many</span>
          </li>
        </ul>
      </section>

      <!-- ----------------------------------------------------- repository -->

      <!--
        Two sections rather than one "Storage", because they are not the same
        kind of thing and should not be backed up the same way. The repository
        is the website. The database is only this server's memory of who is
        signed in.
      -->

      <section class="card p-4" aria-labelledby="repository-heading">
        <h2 id="repository-heading" class="text-sm font-semibold">Content repository</h2>
        <p class="mt-1 text-xs text-muted">
          The source of truth for the website. Everything here is a file under version control, so
          the site can be rebuilt from it without this server.
        </p>

        <dl class="spec mt-3">
          <div>
            <dt>Origin</dt>
            <dd class="mono">{{ info.repository.origin }}</dd>
          </div>
          <div>
            <dt>Entries</dt>
            <dd class="tabular-nums">{{ info.repository.entries }}</dd>
          </div>
          <div>
            <dt>Media</dt>
            <dd class="tabular-nums">
              {{ info.repository.media.files }} files · {{ info.repository.media.readable }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- ------------------------------------------------------- database -->

      <section class="card p-4" aria-labelledby="database-heading">
        <h2 id="database-heading" class="text-sm font-semibold">Operational database</h2>
        <p class="mt-1 text-xs text-muted">
          Accounts and sessions only. Losing it signs everyone out; no content is in it.
        </p>

        <dl class="spec mt-3">
          <div>
            <dt>Accounts</dt>
            <dd class="tabular-nums">{{ info.database.users }}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd class="tabular-nums">
              {{ info.database.bytes === null ? "in memory" : formatBytes(info.database.bytes) }}
              · migration {{ info.database.version }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- ----------------------------------------------------- deployment -->

      <section v-if="info.deployment" class="card p-4" aria-labelledby="deployment-heading">
        <h2 id="deployment-heading" class="text-sm font-semibold">Deployment</h2>
        <p class="mt-1 text-xs text-muted">
          Visible to administrators. Secrets are never shown — only whether they are set.
        </p>

        <p
          v-if="info.deployment.generatedSecrets.length"
          class="mt-3 rounded-md border border-warning/15 bg-warning-soft px-4 py-3 text-xs text-warning"
        >
          Running with generated development secrets
          ({{ info.deployment.generatedSecrets.join(", ") }}). Everyone is signed out on restart —
          set these before this deployment is used for real.
        </p>

        <dl class="spec mt-3">
          <div>
            <dt>Base URL</dt>
            <dd class="mono">{{ info.deployment.baseUrl }}</dd>
          </div>
          <div>
            <dt>Content model</dt>
            <dd class="mono">{{ info.deployment.schemaOrigin }}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd class="mono">{{ info.deployment.databasePath }}</dd>
          </div>
          <div>
            <dt>Repository access</dt>
            <dd>{{ info.deployment.repositoryMode }}</dd>
          </div>
          <div v-if="info.deployment.contentRoot">
            <dt>Content root</dt>
            <dd class="mono">{{ info.deployment.contentRoot }}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{{ info.cms.node }} on {{ info.cms.platform }}</dd>
          </div>
          <div>
            <dt>Memory in use</dt>
            <dd class="tabular-nums">{{ formatBytes(info.deployment.memoryBytes) }}</dd>
          </div>
          <div>
            <dt>Upload limit</dt>
            <dd class="tabular-nums">{{ info.deployment.maxUploadReadable }}</dd>
          </div>
          <div>
            <dt>Session lifetime</dt>
            <dd class="tabular-nums">
              {{ info.deployment.sessionTtlHours }} h, idle out after
              {{ info.deployment.sessionIdleHours }} h
            </dd>
          </div>
          <div>
            <dt>Secure cookies</dt>
            <dd>{{ info.deployment.cookieSecure ? "Yes" : "No (plain HTTP)" }}</dd>
          </div>
          <div>
            <dt>Trust proxy headers</dt>
            <dd>{{ info.deployment.trustProxy ? "Yes" : "No" }}</dd>
          </div>
          <div v-if="info.deployment.adminOrigins.length">
            <dt>Extra admin origins</dt>
            <dd class="mono">{{ info.deployment.adminOrigins.join(", ") }}</dd>
          </div>
          <div>
            <dt>Log level</dt>
            <dd>{{ info.deployment.logLevel }}</dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>

<style scoped>
@reference "../style.css";

/* Term/value rows: the page is mostly these, so they are worth a class. */
.spec {
  @apply divide-y divide-line text-sm;
}

.spec > div {
  @apply flex items-baseline justify-between gap-6 py-1.5;
}

.spec dt {
  @apply shrink-0 text-muted;
}

.spec dd {
  @apply min-w-0 text-right;
}

.mono {
  @apply font-mono text-xs break-all;
}
</style>
