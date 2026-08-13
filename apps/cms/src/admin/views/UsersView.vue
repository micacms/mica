<script setup lang="ts">
/**
 * User administration (§9.1).
 *
 * Administrators create accounts and assign replacement passwords; there is no
 * email-based reset flow, so a deployment needs no mail server.
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

const showCreate = ref(false);
const form = ref({ email: "", name: "", role: "editor", password: "" });
const formError = ref<string | null>(null);

const pendingDelete = ref<AdminUser | null>(null);
const pendingPassword = ref<AdminUser | null>(null);
const newPassword = ref("");

const adminCount = computed(() => users.value.filter((user) => user.role === "admin").length);

async function load(): Promise<void> {
  loading.value = true;
  try {
    users.value = (await api.users.list()).users;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the accounts.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** Suggests a strong temporary password so nobody invents a weak one. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function openCreate(): void {
  form.value = { email: "", name: "", role: "editor", password: generatePassword() };
  formError.value = null;
  showCreate.value = true;
}

async function create(): Promise<void> {
  busy.value = true;
  formError.value = null;

  try {
    await api.users.create(form.value);
    toast.success(
      `Account created for ${form.value.email}.`,
      "Share the password securely; they will be asked to change it.",
    );
    showCreate.value = false;
    await load();
  } catch (error) {
    formError.value =
      error instanceof ApiError ? error.message : "Could not create the account.";
  } finally {
    busy.value = false;
  }
}

async function changeRole(user: AdminUser, role: string): Promise<void> {
  try {
    await api.users.update(user.id, { role });
    toast.success(`${user.email} is now ${role === "admin" ? "an administrator" : "an editor"}.`);
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not change the role.");
    await load();
  }
}

async function assignPassword(): Promise<void> {
  if (!pendingPassword.value) return;
  busy.value = true;

  try {
    await api.users.setPassword(pendingPassword.value.id, newPassword.value);
    toast.success(
      `New password set for ${pendingPassword.value.email}.`,
      "They have been signed out everywhere and must change it at next sign-in.",
    );
    pendingPassword.value = null;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not set the password.");
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  if (!pendingDelete.value) return;
  busy.value = true;

  try {
    await api.users.remove(pendingDelete.value.id);
    toast.success("Account deleted.");
    pendingDelete.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not delete the account.");
  } finally {
    busy.value = false;
  }
}

function openPasswordDialog(user: AdminUser): void {
  newPassword.value = generatePassword();
  pendingPassword.value = user;
}
</script>

<template>
  <PageHeader title="Users" :subtitle="`${users.length} account${users.length === 1 ? '' : 's'}`">
    <button type="button" class="btn-primary" @click="openCreate">Add user</button>
  </PageHeader>

  <div class="mx-auto max-w-5xl px-4 py-5 sm:px-6">
    <p v-if="loading" class="text-sm text-muted">Loading…</p>

    <div v-else class="card overflow-hidden">
      <table class="w-full text-sm">
        <caption class="sr-only">CMS accounts</caption>
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
              <span
                v-if="user.mustChangePassword"
                class="badge mt-1 bg-warning/10 text-warning"
              >
                Must change password
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
              <time v-if="user.lastLoginAt" :datetime="user.lastLoginAt" :title="absoluteTime(user.lastLoginAt)">
                {{ relativeTime(user.lastLoginAt) }}
              </time>
              <span v-else>Never</span>
            </td>

            <td class="px-4 py-2.5">
              <div class="flex justify-end gap-1">
                <button type="button" class="btn-ghost text-xs" @click="openPasswordDialog(user)">
                  Set password
                </button>
                <button
                  type="button"
                  class="btn-ghost text-xs hover:text-danger"
                  :disabled="user.id === auth.user.value?.id"
                  @click="pendingDelete = user"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Create -->
  <ConfirmDialog
    :open="showCreate"
    title="Add a user"
    confirm-label="Create account"
    :busy="busy"
    @cancel="showCreate = false"
    @confirm="create"
  >
    <div class="space-y-3 text-left">
      <p v-if="formError" role="alert" class="rounded bg-danger/8 px-2.5 py-1.5 text-xs text-danger">
        {{ formError }}
      </p>

      <div>
        <label for="new-email" class="field-label">Email</label>
        <input id="new-email" v-model="form.email" type="email" class="input mt-1" required />
      </div>

      <div>
        <label for="new-name" class="field-label">Name</label>
        <input id="new-name" v-model="form.name" type="text" class="input mt-1" />
      </div>

      <div>
        <label for="new-role" class="field-label">Role</label>
        <select id="new-role" v-model="form.role" class="input mt-1">
          <option value="editor">Editor — can manage content</option>
          <option value="admin">Administrator — can also manage users</option>
        </select>
      </div>

      <div>
        <label for="new-password" class="field-label">Temporary password</label>
        <div class="mt-1 flex gap-2">
          <input
            id="new-password"
            v-model="form.password"
            type="text"
            class="input font-mono text-[13px]"
          />
          <button type="button" class="btn-secondary shrink-0" @click="form.password = generatePassword()">
            New
          </button>
        </div>
        <p class="field-hint">Share this securely. They will be asked to change it.</p>
      </div>
    </div>
  </ConfirmDialog>

  <!-- Assign password -->
  <ConfirmDialog
    :open="pendingPassword !== null"
    :title="`Set a new password for ${pendingPassword?.email}`"
    confirm-label="Set password"
    :busy="busy"
    @cancel="pendingPassword = null"
    @confirm="assignPassword"
  >
    <div class="text-left">
      <label for="assigned-password" class="field-label">New password</label>
      <div class="mt-1 flex gap-2">
        <input
          id="assigned-password"
          v-model="newPassword"
          type="text"
          class="input font-mono text-[13px]"
        />
        <button type="button" class="btn-secondary shrink-0" @click="newPassword = generatePassword()">
          New
        </button>
      </div>
      <p class="field-hint">
        This signs them out on every device. They will be asked to choose their own password.
      </p>
    </div>
  </ConfirmDialog>

  <!-- Delete -->
  <ConfirmDialog
    :open="pendingDelete !== null"
    :title="`Delete ${pendingDelete?.email}?`"
    confirm-label="Delete account"
    destructive
    :busy="busy"
    @cancel="pendingDelete = null"
    @confirm="remove"
  >
    <p>
      They will lose access immediately. Content they created stays, but is no longer attributed to
      an account.
    </p>
  </ConfirmDialog>
</template>
