import { describe, expect, test } from 'bun:test'
import { type Framing, textLines } from '../../src/internal/text-lines.js'

async function lines(
  input: string | Iterable<string> | AsyncIterable<string>,
  framing: Framing,
): Promise<[number, string][]> {
  const out: [number, string][] = []
  for await (const { lineNo, text } of textLines(input, framing)) out.push([lineNo, text])
  return out
}

describe('textLines', () => {
  test('a whole string is one chunk; LF and CRLF terminate lines; a final segment counts', async () => {
    expect(await lines('a\nb\r\n\nc', 'text')).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, ''],
      [4, 'c'],
    ])
    expect(await lines('', 'text')).toEqual([])
    expect(await lines('x\n', 'text')).toEqual([[1, 'x']])
  })

  test("'text' framing carries partial segments across any chunking", async () => {
    const text = '10,1,10,"a"\r\n13,905954400,,112,,104\n13,905954401,,98,96,\n'
    const expected = await lines(text, 'text')
    for (const size of [1, 2, 5, 13]) {
      const chunks: string[] = []
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
      async function* stream() {
        yield* chunks
      }
      expect(await lines(stream(), 'text')).toEqual(expected)
    }
    // unterminated elements are NOT lines of their own in text framing
    expect(await lines(['13,1', '2,3'], 'text')).toEqual([[1, '13,12,3']])
  })

  test("'json-lines' framing: complete unterminated objects are lines; their newline is not a blank line", async () => {
    const a = '{"v":1,"x":[1,{"y":2}]}'
    const b = '{"v":1}'
    expect(await lines([a, b], 'json-lines')).toEqual([
      [1, a],
      [2, b],
    ])
    expect(await lines([a, '\n', b, '\r', '\n', '\n'], 'json-lines')).toEqual([
      [1, a],
      [2, b],
      [3, ''],
    ])
    // a prefix ending at a nested brace is not complete
    expect(await lines(['{"v":1,"x":[1,{"y":2}', ']}\n'], 'json-lines')).toEqual([[1, a]])
    // non-object JSON is carried like text
    expect(await lines(['[1,', '2]'], 'json-lines')).toEqual([[1, '[1,2]']])
  })

  test('rejects non-string inputs and chunks', async () => {
    const invalid = expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error
    await expect(lines(42 as unknown as string, 'text')).rejects.toThrow(invalid)
    await expect(lines([1] as unknown as string[], 'text')).rejects.toThrow(invalid)
  })
})

describe('textLines: ReadableStream without async iteration', () => {
  test('falls back to the stream reader', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('13,1,')
        controller.enqueue('2\n13,3,4\n')
        controller.close()
      },
    })
    // hide the async iterator as older engines do
    const legacy = { getReader: () => stream.getReader() }
    expect(await lines(legacy as unknown as AsyncIterable<string>, 'text')).toEqual([
      [1, '13,1,2'],
      [2, '13,3,4'],
    ])
  })
})
