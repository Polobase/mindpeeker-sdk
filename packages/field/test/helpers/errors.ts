import { FieldError } from '../../src/errors.js'

/** The FieldError code a synchronous call throws (`'no error'` / `'foreign error'` otherwise). */
export function thrownCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return error instanceof FieldError ? error.code : 'foreign error'
  }
  return 'no error'
}

/** The FieldError code a promise rejects with (`'no error'` / `'foreign error'` otherwise). */
export async function rejectedCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof FieldError ? error.code : 'foreign error'
  }
  return 'no error'
}
