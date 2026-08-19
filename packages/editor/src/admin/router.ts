import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { useSession } from "@/stores/session";
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
    // The slug, not an id: the address in the admin is the path in the
    // repository, so a URL here can be read straight off a diff.
    path: "/collections/:collection/:slug",
    name: "entry",
    component: () => import("@/views/EntryView.vue"),
    props: true,
  },
  {
    path: "/singletons/:name",
    name: "singleton",
    component: () => import("@/views/SingletonView.vue"),
    props: true,
  },
  {
    path: "/media",
    name: "media",
    component: () => import("@/views/MediaView.vue"),
    meta: { title: "Media" },
  },
  {
    path: "/system",
    name: "system",
    component: () => import("@/views/SystemView.vue"),
    meta: { title: "System" },
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
  const session = useSession();

  if (!session.checked.value) await session.restore();

  if (to.meta.public) {
    // Nobody with a live session has a reason to see the sign-in screen.
    return session.isActive.value ? { name: "dashboard" } : true;
  }

  if (!session.isActive.value) {
    return { name: "login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } };
  }

  // Every view renders from the model, so it must be present.
  await useSchema().load();
  return true;
});

router.afterEach((to) => {
  const title = typeof to.meta.title === "string" ? to.meta.title : null;
  document.title = title ? `${title} · Mica` : "Mica";
});
