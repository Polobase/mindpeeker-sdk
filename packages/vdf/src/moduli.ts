import type { RsaModulus } from './types.js'

const RSA2048_DECIMAL =
  '2519590847565789349402718324004839857142928212620403202777713783604366202070' +
  '7595556264018525880784406918290641249515082189298559149176184502808489120072' +
  '8449926873928072877767359714183472702618963750149718246911650776133798590957' +
  '0009733045974880842840179742910064245869181719511874612151517265463228221686' +
  '9987549182422433637259085141865462043576798423387184774447920739934236584823' +
  '8242811981638150106748104516603773060562016196762561338441436038339044149526' +
  '3443219011465754445417842402092461651572335077870774981712577246796292638635' +
  '6373289912154831438167899885040445364023527381951378636564391212010397122822' +
  '120720357'

/**
 * RSA-2048, the 2048-bit (617 decimal digit) modulus of the RSA Factoring
 * Challenge — the default group of unknown order for every function in this
 * package.
 *
 * Provenance: the RSA Factoring Challenge was launched by RSA Laboratories in
 * 1991 (RSA-2048 itself carried the top prize, USD 200,000, in the relaunched
 * 2001 listing) and withdrawn in 2007; RSA-2048 remains unfactored. RSA Labs
 * stated the challenge moduli were generated on a computer with no network
 * connection and that the primes were discarded after generation, so *nobody*
 * is believed to know $\varphi(n)$ — the trapdoor-free assumption Pietrzak's
 * VDF needs. References: RSA Laboratories, "The RSA Factoring Challenge"
 * (1991–2007); Kaye, "The RSA Challenge Numbers" archive; the same modulus is
 * used by Chia's proof-of-time and the VDF Alliance.
 *
 * Trust note: unlike a class group there is no public ceremony proving the
 * factors were destroyed. If that residual trust is unacceptable, plug in
 * your own modulus — every API takes `{ n: bigint }`.
 */
export const RSA2048: RsaModulus = Object.freeze({ n: BigInt(RSA2048_DECIMAL) })
