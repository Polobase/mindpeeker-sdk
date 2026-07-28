<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/psi</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Mind–matter experiment</h1>
    <p class="mt-2 max-w-3xl text-muted">
      Each trial is 200 fair coin flips; you aim them high (more 1s), low (more 0s), or idle. The
      cumulative Stouffer Z and the Bayes factor test your run against pure chance. The mathematics
      is exact; whether intention moves the number is the open question — and the honest default is
      no.
    </p>
    <ClientOnly>
      <PsiDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading experiment…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
