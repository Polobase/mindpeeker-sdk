import { type ByteReader, byteReader } from '@mindpeeker/oracle'
import type { ByteSource } from '../types.js'

/**
 * Open a reader over `source`. The caller owns it and must `close()` it in a
 * `finally` — that runs the source's own cleanup (a serial port's `close()`,
 * a camera track's `stop()`) once the scan is done, failed, or was aborted.
 * The stream itself is opened lazily on the first byte.
 */
export function openReader(source: ByteSource, signal: AbortSignal | undefined): ByteReader {
  return byteReader(source, signal !== undefined ? { signal } : {})
}

/**
 * A non-closing {@link ByteSource} view of an open reader, for handing a
 * shared stream to a consumer that opens and closes its own stream (psi's
 * `runTripolar`). Each `stream()` continues where the reader stands, closing
 * the view's iterator never closes the reader, and chunks are exactly
 * `chunkBytes` long so the consumer never buffers bytes it does not use —
 * the next consumer of the reader sees every byte the view did not hand out.
 *
 * A source that runs dry ends the view's stream cleanly (after any partial
 * chunk); every other reader error propagates to the consumer.
 */
export function readerView(reader: ByteReader, name: string, chunkBytes: number): ByteSource {
  return {
    name,
    stream: () => viewStream(reader, chunkBytes),
  }
}

async function* viewStream(
  reader: ByteReader,
  chunkBytes: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  for (;;) {
    const chunk = new Uint8Array(chunkBytes)
    for (let i = 0; i < chunkBytes; i++) {
      try {
        chunk[i] = await reader.next()
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== 'insufficient_entropy') throw error
        if (i > 0) yield chunk.subarray(0, i)
        return
      }
    }
    yield chunk
  }
}
