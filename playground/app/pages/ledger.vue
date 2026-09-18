<template>
  <DemoPage id="ledger">
    <template #intro>
      Six pieces of standard cryptography, each doing one small job exactly: RFC 8785 canonical JSON
      so two parties hash the same bytes, a hash chain so a line cannot be edited unnoticed, RFC 6962
      Merkle proofs so one record is provable without shipping the log, C2SP signed checkpoints so a
      tree head has an author, Blum commit–reveal so nobody picks a number after seeing yours, and a
      beacon-plus-VDF time bracket that bounds a record from below in time. Every result below is
      recomputed in your browser and every failure case is run, not described.
    </template>
    <LedgerDemo />
  </DemoPage>
</template>
