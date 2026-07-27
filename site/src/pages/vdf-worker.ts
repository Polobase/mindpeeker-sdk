// Web Worker: run the sequential VDF off the main thread so the page stays
// responsive. Evaluate (the enforced delay), prove, then verify — reporting
// progress and timings back to the page.

import { evaluate, pietrzakProve, pietrzakVerify } from '@mindpeeker/vdf'

self.onmessage = async (event: MessageEvent) => {
  const { input, T } = event.data as { input: Uint8Array; T: number }
  try {
    const tEval = performance.now()
    const { y } = await evaluate(input, T, {
      onProgress: (done: number, total: number) =>
        self.postMessage({ type: 'progress', done, total }),
    })
    const evalMs = performance.now() - tEval

    self.postMessage({ type: 'phase', phase: 'proving' })
    const tProve = performance.now()
    const proof = await pietrzakProve(input, T, y)
    const proveMs = performance.now() - tProve

    self.postMessage({ type: 'phase', phase: 'verifying' })
    const tVerify = performance.now()
    const ok = await pietrzakVerify(input, T, y, proof)
    const verifyMs = performance.now() - tVerify

    self.postMessage({
      type: 'done',
      T,
      y: y.toString(16),
      rounds: proof.mus.length,
      ok,
      evalMs,
      proveMs,
      verifyMs,
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
