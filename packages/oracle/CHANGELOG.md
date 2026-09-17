# @mindpeeker/oracle

## 0.2.0

### Minor Changes

- Readers now have a lifecycle (casts close the streams they open, shared readers honour a per-cast `signal`), source failures are typed, and six divination systems are added with tables checked against primary texts. Outputs for the 0.1.0 options are unchanged. See "Behaviour changes in 0.2.0" in the package README for the full list.

  - BREAKING: `ByteReader` gains `close()`, `[Symbol.asyncDispose]()` and the optional `bytesFetched`; custom implementations of the interface must add them. Objects with only `next()` and `bytesConsumed` are still accepted as inputs.
  - BREAKING: casts close the reader they create. An `AsyncIterable` passed directly to a cast is finished afterwards; to continue one stream across casts, share `byteReader(iterable)` and close it yourself (`await using`).
  - BREAKING: source failures are wrapped as `OracleError('source_error')` with the original error as `cause` instead of propagating raw.
  - BREAKING: concurrent casts on one reader, and concurrent `next()` calls on a stream reader, throw `invalid_input` instead of silently interleaving bytes.
  - BREAKING: stricter validation. Inherited method or spread names, `null` or malformed spreads, non-boolean `reversals`/`merkstave`, `method: null`, `null` options and an invalid `signal` or `chunkBytes` throw typed errors.
  - BREAKING (types): `CastMethod` adds `'singleLine'` (`LINE_WEIGHTS` is keyed by `LineMethod`); `SpreadName` adds `'celticCrossWaite'`; `Rune.aett` and `Rune.aettName` may be `null`; `GeomanticFigure` gains `sign` and `node`; `Rune` gains `modern`. Exhaustive switches and custom objects of these types must follow.
  - BREAKING: `castRunes` validates its options before `count`, `expectedBytes` rejects `null` options and a `significator` given with a `DealSpec`, and `houses` takes `{ system }` (default: the 0.1.0 sequential placement).
  - BREAKING: `engines.node` is `>=20.19` (was `>=20.3`); the tarball now includes a LICENSE file.
  - A per-cast `signal` aborts a cast on a shared reader (0.1.0 ignored it). Casts request `chunkBytes: 32` from a `ByteSource` they open. `drawWithoutReplacement` no longer allocates O(n) memory (same outputs), so n = 2³² works. A custom spread is returned as a frozen copy.
  - New systems: `castOdu` (Ifá, opele or ikin), `castCowries` (sixteen cowries), `castLot` (kau cim fortune sticks with jiaobei confirmation), `castMo` (Tibetan Mo), `castAstragaloi`, `castHomeromanteion`. Each table cites its source or is marked as modeled.
  - New in existing systems: geomancy `reconciler`, `partOfFortune`, `houses(shield, { system: 'goldenDawn' })` and `figureElement`; I Ching `method: 'singleLine'`, `nuclearHexagram`, `inverseHexagram`, `oppositeHexagram`, `fuXiNumber`, `hexagramFromFuXi` and Legge names; Tarot `celticCrossWaite`, `significator` and weighted `reversals`; runes `futhark: 'younger' | 'futhorc28' | 'futhorc29' | 'futhorc33'`, the blank rune, the `'norns'` layout and `castRuneSets`.
  - New core helpers: `recordingReader` (capture consumed bytes for exact replay), `weightedIndexRational` (exact non-dyadic weights), `expectedBytes`, `DEFAULT_CAST_CHUNK_BYTES`.
