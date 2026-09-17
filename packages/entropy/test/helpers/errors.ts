import { expect } from 'bun:test'
import { EntropyError, type EntropyErrorCode } from '../../src/errors.js'

/** Run `fn`, assert it throws an `EntropyError` with `code`, and return the error. */
export function thrownEntropyError(fn: () => unknown, code: EntropyErrorCode): EntropyError {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(EntropyError)
  expect((caught as EntropyError).code).toBe(code)
  return caught as EntropyError
}

/** Await `promise`, assert it rejects with an `EntropyError` with `code`, and return the error. */
export async function rejectedEntropyError(
  promise: Promise<unknown>,
  code: EntropyErrorCode,
): Promise<EntropyError> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(caught).toBeInstanceOf(EntropyError)
  expect((caught as EntropyError).code).toBe(code)
  return caught as EntropyError
}
