import { expect } from 'bun:test'
import { CoincidenceError, type CoincidenceErrorCode } from '../../src/index.js'

/** Asserts that `fn` throws a CoincidenceError with this code (and argument, when given). */
export function expectCoincidenceError(
  fn: () => unknown,
  code: CoincidenceErrorCode,
  argument?: string,
): CoincidenceError {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(CoincidenceError)
  const error = caught as CoincidenceError
  expect(error.code).toBe(code)
  if (argument !== undefined) expect(error.argument).toBe(argument)
  return error
}

export function expectInvalid(fn: () => unknown, argument?: string): CoincidenceError {
  return expectCoincidenceError(fn, 'invalid_input', argument)
}
