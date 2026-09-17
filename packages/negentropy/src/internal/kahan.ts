/**
 * Compensated summation — keeps long accumulations at O(ε) error.
 *
 * Implements Neumaier's (1974) improvement of Kahan's (1965) algorithm: the
 * running error is accumulated for whichever operand is smaller, so the
 * result stays correct even when an added term exceeds the running sum
 * (1e16 + 1 − 1e16 = 1, where classic Kahan returns 0). The class name is
 * kept for compatibility; `value` returns sum + compensation.
 */
export class KahanSum {
  #sum = 0
  #compensation = 0

  add(x: number): void {
    const t = this.#sum + x
    if (Math.abs(this.#sum) >= Math.abs(x)) this.#compensation += this.#sum - t + x
    else this.#compensation += x - t + this.#sum
    this.#sum = t
  }

  get value(): number {
    return this.#sum + this.#compensation
  }
}
