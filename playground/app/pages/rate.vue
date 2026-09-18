<template>
  <DemoPage id="rate">
    <template #intro>
      Malcolm Rae replaced the numbered dials of earlier radionic instruments with a card: concentric
      circles, each carrying one short radial line, the set of angles being the rate. This page makes
      that encoding exact — parse a rate in base 44 or base 10, read every digit's angle as a
      rational number beside the double the code returns, render the card and the dials, take the
      directional statistics of the ring angles against random rates from your selected entropy
      source, and run the reversible stream modulation. The geometry, the statistics and the
      modulation are ordinary mathematics. The radionic claim attached to them — that a card imprints
      a remedy or acts at a distance — is not asserted, tested or supported anywhere here.
    </template>
    <RateDemo />
  </DemoPage>
</template>
