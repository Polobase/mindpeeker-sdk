import { describe, expect, test } from 'bun:test'
import { VisualizerError } from '../src/errors.js'

describe('VisualizerError', () => {
  test('carries code, channel, and cause', () => {
    const cause = new Error('root')
    const error = new VisualizerError('protocol', 'bad frame', { channel: 'noise', cause })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('VisualizerError')
    expect(error.code).toBe('protocol')
    expect(error.channel).toBe('noise')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('bad frame')
  })

  test('omits cause when none was given', () => {
    const error = new VisualizerError('aborted', 'stopped')
    expect(error.cause).toBeUndefined()
    expect(error.channel).toBeUndefined()
  })
})
