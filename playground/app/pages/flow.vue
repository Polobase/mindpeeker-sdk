<template>
  <DemoPage id="flow">
    <template #intro>
      Transfer entropy asks a directional question about two streams: how many bits does the past of
      X tell you about the next symbol of Y, beyond what Y’s own past already tells you? Everything
      below is built from series with a known answer — a planted copy, a hidden driver, a memory at
      one lag — so you can watch the estimator recover what was put there, and watch it report flow
      where there is none. Finite samples always give a positive value; read it against a null,
      never alone.
    </template>
    <FlowDemo />
  </DemoPage>
</template>
