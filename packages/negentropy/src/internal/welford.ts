/** Welford's one-pass, numerically stable mean/variance accumulator. */
export class Welford {
  #n = 0
  #mean = 0
  #m2 = 0

  push(x: number): void {
    this.#n++
    const delta = x - this.#mean
    this.#mean += delta / this.#n
    this.#m2 += delta * (x - this.#mean)
  }

  get n(): number {
    return this.#n
  }

  get mean(): number {
    return this.#mean
  }

  /** Sample variance (n − 1 denominator). NaN below two observations. */
  get variance(): number {
    return this.#n < 2 ? Number.NaN : this.#m2 / (this.#n - 1)
  }

  /** Population variance (n denominator). NaN with no observations. */
  get populationVariance(): number {
    return this.#n < 1 ? Number.NaN : this.#m2 / this.#n
  }

  get sd(): number {
    return Math.sqrt(this.variance)
  }
}
