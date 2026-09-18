<template>
  <DemoPage id="entropy">
    <template #intro>
      Thirty entropy backends — quantum vacuum, photon detectors, atmospheric radio, camera and
      microphone noise, CPU jitter, serial hardware, public beacons and a seeded HMAC_DRBG — behind
      one tiny interface, so a QRNG, a beacon and your browser’s CSPRNG plug in identically. Every
      result says where its bytes actually came from; every local source runs the SP 800-90B health
      pipeline. This page draws live from whatever you picked in the header, and every number below
      is either exact arithmetic or a labelled measurement.
    </template>
    <EntropyDemo />
  </DemoPage>
</template>
