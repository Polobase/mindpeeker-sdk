<template>
  <DemoPage id="vdf">
    <template #intro>
      Computing y = |x^(2^T)| mod n takes T sequential squarings that no amount of parallelism can
      shortcut, yet anyone can check the answer in O(log T) — a proof that time passed. This page
      runs the whole thing in a Web Worker: both proof systems side by side, the negated-output
      forgery that 0.2.0 closed, the modulus policy, a sealed beacon pulse broken four ways, and the
      calibration that turns T into seconds. A seal is a no-earlier-than bound, never a
      no-later-than one.
    </template>
    <VdfDemo />
  </DemoPage>
</template>
