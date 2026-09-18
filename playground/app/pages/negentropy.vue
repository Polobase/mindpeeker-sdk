<template>
  <DemoPage id="negentropy">
    <template #intro>
      Two questions about a stream of bits: is there any order in it, and how much usable order can
      be pulled back out? Everything below runs live in your browser over the source selected in the
      header — quality estimators with exact nulls, GCP network statistics, anytime-valid sequential
      monitoring, a pre-registered experiment with a SHA-256 envelope hash, debiasing and extraction
      with honest min-entropy accounting, and the numerical core underneath. A passing battery
      proves nothing about physical unpredictability; these tests can only ever <em>fail</em> a
      source.
    </template>
    <NegentropyDemo />
  </DemoPage>
</template>
