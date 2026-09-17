import { describe, expect, test } from 'bun:test'
import * as node from '../../src/node/index.js'

describe('@mindpeeker/entropy/node exports', () => {
  test('exposes every Node adapter documented in the README', () => {
    expect(Object.keys(node).sort()).toEqual([
      'ffmpegFrameSource',
      'ffmpegSampleSource',
      'hwRng',
      'nodeSerialSource',
      'rtlSdrArgs',
      'rtlSdrSource',
    ])
  })
})
