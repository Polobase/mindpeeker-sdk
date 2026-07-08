/**
 * Neumaier-compensated summation (Neumaier 1974): like Kahan's algorithm but
 * also correct when the addend exceeds the running sum in magnitude. Used for
 * the pointwise transfer-entropy sums so streamed and batch results agree to
 * full double precision.
 */
export class KahanSum {
  #sum = 0
  #compensation = 0

  add(value: number): void {
    const t = this.#sum + value
    if (Math.abs(this.#sum) >= Math.abs(value)) {
      this.#compensation += this.#sum - t + value
    } else {
      this.#compensation += value - t + this.#sum
    }
    this.#sum = t
  }

  get value(): number {
    return this.#sum + this.#compensation
  }
}
