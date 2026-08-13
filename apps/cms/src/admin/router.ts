import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { useAuth } from "@/stores/auth";
import { useSchema } from "@/stores/schema";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/LoginView.vue"),
    meta: { public: true, title: "Sign in" },
  },
  {
    path: "/",
    name: "dashboard",
    component: () => import("@/views/DashboardView.vue"),
    meta: { title: "Overview" },
  },
  {
    path: "/collections/:collection",
    name: "collection",
    component: () => import("@/views/CollectionView.vue"),
    props: true,
  },
  {
    path: "/collections/:collection/new",
    name: "entry-new",
    component: () => import("@/views/EntryView.vue"),
    props: true,
  },
  {
    path: "/collections/:collection/:id",
    name: "entry",
    component: () => import("@/views/EntryView.vue"),
    props: true,
  },
  {
    path: "/globals/:name",
    name: "global",
    component: () => import("@/views/GlobalView.vue"),
    props: true,
  },
  {
    path: "/media",
    name: "media",
    component: () => import("@/views/MediaView.vue"),
    meta: { title: "Media" },
  },
  {
    path: "/users",
    name: "users",
    component: () => import("@/views/UsersView.vue"),
    meta: { title: "Users", adminOnly: true },
  },
  {
    path: "/system",
    name: "system",
    component: () => import("@/views/SystemView.vue"),
    meta: { title: "System" },
  },
  {
    path: "/account",
    name: "account",
    component: () => import("@/views/AccountView.vue"),
    meta: { title: "Your account" },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("@/views/NotFoundView.vue"),
    meta: { title: "Not found" },
  },
];

export const router = createRouter({
  // The SPA is mounted at /admin/ by the Hono app.
  history: createWebHistory("/admin/"),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
  const auth = useAuth();

  if (!auth.checked.value) await auth.restore();

  if (to.meta.public) {
    // A signed-in user has no reason to see the sign-in form.
    return auth.isAuthenticated.value ? { name: "dashboard" } : true;
  }

  if (!auth.isAuthenticated.value) {
    return { name: "login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } };
  }

  if (to.meta.adminOnly && !auth.isAdmin.value) {
    return { name: "dashboard" };
  }

  // Every authenticated view renders from the model, so it must be present.
  await useSchema().load();
  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === "string" ? to.meta.title : null;
  document.title = title ? `${title} · Mica CMS` : "Mica CMS";
});
