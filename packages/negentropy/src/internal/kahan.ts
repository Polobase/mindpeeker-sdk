/** Kahan-compensated summation — keeps long accumulations at O(ε) error. */
export class KahanSum {
  #sum = 0
  #compensation = 0

  add(x: number): void {
    const y = x - this.#compensation
    const t = this.#sum + y
    this.#compensation = t - this.#sum - y
    this.#sum = t
  }

  get value(): number {
    return this.#sum
  }
}
