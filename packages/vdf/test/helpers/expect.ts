import { expect } from 'bun:test'
import type { VdfErrorCode } from '../../src/errors.js'
import { VdfError } from '../../src/errors.js'

/** Await a promise and assert it rejects with a VdfError carrying `code`. */
export async function expectVdfError(promise: Promise<unknown>, code: VdfErrorCode): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(VdfError)
  expect((caught as VdfError).code).toBe(code)
}

/** Run a function and assert it throws a VdfError carrying `code`. */
export function expectVdfThrow(fn: () => unknown, code: VdfErrorCode): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(VdfError)
  expect((caught as VdfError).code).toBe(code)
}
