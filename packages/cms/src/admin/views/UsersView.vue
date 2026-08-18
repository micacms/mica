<script setup lang="ts">
/**
 * Who may edit this site.
 *
 * Not account management: Mica does not create people, an identity provider
 * does. Inviting someone records that whoever holds an email address may edit
 * here; removing them withdraws it. Neither affects whether they can sign in to
 * the provider — that is somebody else's screen, in somebody else's product.
 *
 * There is no password column, no reset button and no temporary password to
 * pass along: none of that is Mica's to hold.
 */

import { computed, onMounted, ref } from "vue";

import { api, ApiError, type AdminUser } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import { absoluteTime, relativeTime } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";

const auth = useAuth();
const toast = useToast();

const users = ref<AdminUser[]>([]);
const loading = ref(true);
const busy = ref(false);

const showInvite = ref(false);
const form = ref({ email: "", name: "", role: "editor" });
const formError = ref<string | null>(null);

const pendingRemove = ref<AdminUser | null>(null);

const adminCount = computed(() => users.value.filter((user) => user.role === "admin").length);
const pendingCount = computed(() => users.value.filter((user) => user.pending).length);

async function load(): Promise<void> {
  loading.value = true;
  try {
    users.value = (await api.users.list()).users;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the members.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openInvite(): void {
  form.value = { email: "", name: "", role: "editor" };
  formError.value = null;
  showInvite.value = true;
}

async function invite(): Promise<void> {
  busy.value = true;
  formError.value = null;

  try {
    await api.users.invite(form.value);
    toast.success(
      `${form.value.email} can now edit this site.`,
      "They get in by signing in with that address — there is nothing to send them.",
    );
    showInvite.value = false;
    await load();
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : "Could not add that person.";
  } finally {
    busy.value = false;
  }
}

async function changeRole(user: AdminUser, role: string): Promise<void> {
  try {
    await api.users.update(user.id, { role });
    toast.success(`${user.email} is now ${role === "admin" ? "an administrator" : "an editor"}.`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not change the role.");
  } finally {
    // Either way: a failed change must not leave the select showing the value
    // the server rejected.
    await load();
  }
}

async function remove(): Promise<void> {
  if (!pendingRemove.value) return;
  busy.value = true;

  try {
    await api.users.remove(pendingRemove.value.id);
    toast.success("Access removed.");
    pendingRemove.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not remove their access.");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHeader
    title="People"
    :subtitle="`${users.length} ${users.length === 1 ? 'person' : 'people'} can edit this site`"
  >
    <button type="button" class="btn-primary" @click="openInvite">Add someone</button>
  </PageHeader>

  <div class="mx-auto max-w-5xl px-4 py-5 sm:px-6">
    <p v-if="pendingCount" class="mb-3 text-xs text-muted">
      {{ pendingCount }} {{ pendingCount === 1 ? "person has" : "people have" }} not signed in yet.
    </p>

    <p v-if="loading" class="text-sm text-muted">Loading…</p>

    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <caption class="sr-only">People with access to this site</caption>
        <thead>
          <tr class="border-b border-line text-left text-xs text-muted">
            <th scope="col" class="px-4 py-2 font-medium">Person</th>
            <th scope="col" class="px-4 py-2 font-medium">Role</th>
            <th scope="col" class="hidden px-4 py-2 font-medium sm:table-cell">Last signed in</th>
            <th scope="col" class="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>

        <tbody class="divide-y divide-line">
          <tr v-for="user in users" :key="user.id">
            <td class="px-4 py-2.5">
              <span class="block font-medium">
                {{ user.name || user.email.split("@")[0] }}
                <span v-if="user.id === auth.user.value?.id" class="text-xs text-muted">
                  (you)
                </span>
              </span>
              <span class="block text-xs text-muted">{{ user.email }}</span>
              <!-- An invitation still outstanding after a few days is usually a
                   mistyped address, so it is worth showing rather than hiding. -->
              <span v-if="user.pending" class="badge mt-1 bg-warning-soft text-warning">
                Invited — not signed in yet
              </span>
            </td>

            <td class="px-4 py-2.5">
              <select
                :value="user.role"
                class="input py-1 text-xs"
                :disabled="user.role === 'admin' && adminCount <= 1"
                :aria-label="`Role for ${user.email}`"
                @change="changeRole(user, ($event.target as HTMLSelectElement).value)"
              >
                <option value="editor">Editor</option>
                <option value="admin">Administrator</option>
              </select>
            </td>

            <td class="hidden px-4 py-2.5 text-xs text-muted sm:table-cell">
              <time
                v-if="user.lastLoginAt"
                :datetime="user.lastLoginAt"
                :title="absoluteTime(user.lastLoginAt)"
              >
                {{ relativeTime(user.lastLoginAt) }}
              </time>
              <span v-else>Never</span>
            </td>

            <td class="px-4 py-2.5">
              <div class="flex justify-end">
                <button
                  type="button"
                  class="btn-ghost text-xs hover:text-danger"
                  :disabled="user.id === auth.user.value?.id"
                  @click="pendingRemove = user"
                >
                  Remove
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Invite -->
  <ConfirmDialog
    :open="showInvite"
    title="Give someone access"
    confirm-label="Add"
    :busy="busy"
    @cancel="showInvite = false"
    @confirm="invite"
  >
    <div class="space-y-3 text-left">
      <p v-if="formError" role="alert" class="rounded-md border border-danger/15 bg-danger-soft px-3 py-2 text-xs text-danger">
        {{ formError }}
      </p>

      <div>
        <label for="new-email" class="field-label">Email</label>
        <input id="new-email" v-model="form.email" type="email" class="input mt-1" required />
        <p class="field-hint">
          The address they use with your identity provider. It has to match exactly.
        </p>
      </div>

      <div>
        <label for="new-name" class="field-label">Name</label>
        <input id="new-name" v-model="form.name" type="text" class="input mt-1" />
        <p class="field-hint">
          Only until they first sign in — after that the provider's name is used.
        </p>
      </div>

      <div>
        <label for="new-role" class="field-label">Role</label>
        <select id="new-role" v-model="form.role" class="input mt-1">
          <option value="editor">Editor — can manage content</option>
          <option value="admin">Administrator — can also manage people</option>
        </select>
      </div>

      <p class="text-xs text-muted">
        There is nothing to send. They sign in with that address and they are in.
      </p>
    </div>
  </ConfirmDialog>

  <!-- Remove -->
  <ConfirmDialog
    :open="pendingRemove !== null"
    :title="`Remove ${pendingRemove?.email}?`"
    confirm-label="Remove access"
    destructive
    :busy="busy"
    @cancel="pendingRemove = null"
    @confirm="remove"
  >
    <p>
      They lose access immediately, on every device. Their commits stay in the
      repository's history, as commits do.
    </p>
    <p class="mt-2 text-xs text-muted">
      This does not touch their account at your identity provider.
    </p>
  </ConfirmDialog>
</template>
