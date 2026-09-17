import { PsiError } from '../errors.js'

/** An async iterator over a sync or async iterable. */
export function asyncIteratorOf<T>(
  input: Iterable<T> | AsyncIterable<T>,
  what: string,
): AsyncIterator<T> {
  if (input !== null && typeof input === 'object') {
    if (Symbol.asyncIterator in input) {
      return (input as AsyncIterable<T>)[Symbol.asyncIterator]()
    }
    if (Symbol.iterator in input) {
      const iterator = (input as Iterable<T>)[Symbol.iterator]()
      return {
        next: async () => iterator.next(),
        return: async (value?: unknown) =>
          iterator.return?.(value) ?? { done: true, value: undefined as T },
      }
    }
  }
  throw new PsiError('invalid_plan', `${what} must be an iterable or async iterable`)
}
