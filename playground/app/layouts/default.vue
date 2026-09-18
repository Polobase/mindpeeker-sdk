<template>
  <div class="min-h-screen flex flex-col bg-default">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm"
    >
      Skip to content
    </a>
    <AppHeader />
    <main id="main" class="flex-1">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
