<template>
  <div class="grid min-h-[60vh] place-items-center p-6 text-center">
    <div>
      <p class="text-sm font-semibold text-muted">Not found</p>
      <h1 class="mt-1 text-xl font-semibold tracking-tight">This page does not exist</h1>
      <p class="mt-1.5 text-sm text-muted">
        The link may be out of date, or the content may have been deleted.
      </p>
      <RouterLink :to="{ name: 'dashboard' }" class="btn-primary mt-5">Back to overview</RouterLink>
    </div>
  </div>
</template>
