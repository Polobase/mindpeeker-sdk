<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/flow</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Transfer entropy</h1>
    <p class="mt-2 max-w-3xl text-muted">
      Transfer entropy measures how much one stream’s past reduces uncertainty about another’s next
      symbol, beyond that stream’s own past. Here Y copies X’s previous bit with the coupling
      probability below — so TE(X→Y) should rise with coupling while TE(Y→X) stays near zero.
    </p>
    <ClientOnly>
      <FlowDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading transfer entropy…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
