import { describe, expect, test } from 'bun:test'
import { VisualizerError } from '../src/errors.js'
import {
  decodeFrame,
  encodeBytesFrame,
  encodeMatrixFrame,
  encodeSeriesFrame,
  FRAME_KIND,
  HEADER_BYTES,
  PROTOCOL_VERSION,
  parseTextMessage,
  SERIES_POINT_BYTES,
} from '../src/protocol.js'
import { prngBytes } from './helpers/streams.js'

describe('bytes frames', () => {
  test('round-trips arbitrary chunks', () => {
    const payload = prngBytes(1000)
    const frame = encodeBytesFrame(7, payload)
    const decoded = decodeFrame(frame)
    expect(decoded.kind).toBe('bytes')
    if (decoded.kind !== 'bytes') throw new Error('unreachable')
    expect(decoded.channelId).toBe(7)
    expect(decoded.bytes).toEqual(payload)
  })

  test('round-trips an empty chunk', () => {
    const decoded = decodeFrame(encodeBytesFrame(0, new Uint8Array(0)))
    if (decoded.kind !== 'bytes') throw new Error('wrong kind')
    expect(decoded.bytes.length).toBe(0)
  })

  test('header layout is exactly [version, kind, u16 LE id]', () => {
    const frame = encodeBytesFrame(0x1234, new Uint8Array([0xaa]))
    expect(frame[0]).toBe(PROTOCOL_VERSION)
    expect(frame[1]).toBe(FRAME_KIND.bytes)
    // little-endian: low byte first
    expect(frame[2]).toBe(0x34)
    expect(frame[3]).toBe(0x12)
    expect(frame[4]).toBe(0xaa)
    expect(frame.length).toBe(HEADER_BYTES + 1)
  })

  test('rejects channel ids outside u16', () => {
    expect(() => encodeBytesFrame(-1, new Uint8Array(0))).toThrow(VisualizerError)
    expect(() => encodeBytesFrame(65_536, new Uint8Array(0))).toThrow(VisualizerError)
    expect(() => encodeBytesFrame(1.5, new Uint8Array(0))).toThrow(VisualizerError)
    try {
      encodeBytesFrame(-1, new Uint8Array(0))
    } catch (error) {
      expect((error as VisualizerError).code).toBe('invalid_channel')
    }
  })
})

describe('series frames', () => {
  test('round-trips banded and bandless points', () => {
    const points = [
      { t: 0, value: 1.25 },
      { t: 1.5, value: -3.75, band: [-4, 4] as const },
      { t: 2, value: 0 },
    ]
    const decoded = decodeFrame(encodeSeriesFrame(3, points))
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.channelId).toBe(3)
    expect(decoded.points).toHaveLength(3)
    expect(decoded.points[0]).toEqual({ t: 0, value: 1.25 })
    expect(decoded.points[1]?.band).toEqual([-4, 4])
    expect(decoded.points[2]?.band).toBeUndefined()
  })

  test('absent band encodes as NaN and survives the round-trip as undefined', () => {
    const frame = encodeSeriesFrame(0, [{ t: 1, value: 2 }])
    const view = new DataView(frame.buffer)
    expect(Number.isNaN(view.getFloat64(HEADER_BYTES + 16, true))).toBe(true)
    expect(Number.isNaN(view.getFloat64(HEADER_BYTES + 24, true))).toBe(true)
    const decoded = decodeFrame(frame)
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.points[0]?.band).toBeUndefined()
  })

  test('preserves float64 values exactly', () => {
    const value = 0.1 + 0.2 // classic non-representable sum
    const decoded = decodeFrame(
      encodeSeriesFrame(0, [{ t: Number.MAX_SAFE_INTEGER, value, band: [1e-300, 1e300] }]),
    )
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.points[0]?.t).toBe(Number.MAX_SAFE_INTEGER)
    expect(decoded.points[0]?.value).toBe(value)
    expect(decoded.points[0]?.band).toEqual([1e-300, 1e300])
  })

  test('empty point list round-trips', () => {
    const decoded = decodeFrame(encodeSeriesFrame(9, []))
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.points).toHaveLength(0)
  })

  test('rejects a payload that is not a multiple of the point size', () => {
    const good = encodeSeriesFrame(0, [{ t: 1, value: 2 }])
    const truncated = good.slice(0, HEADER_BYTES + SERIES_POINT_BYTES - 1)
    expect(() => decodeFrame(truncated)).toThrow(VisualizerError)
    try {
      decodeFrame(truncated)
    } catch (error) {
      expect((error as VisualizerError).code).toBe('protocol')
    }
  })
})

describe('matrix frames', () => {
  test('round-trips a rows×cols matrix', () => {
    const data = new Float32Array([1, 2, 3, 4, 5, 6])
    const decoded = decodeFrame(encodeMatrixFrame(11, { rows: 2, cols: 3, data }))
    if (decoded.kind !== 'matrix') throw new Error('wrong kind')
    expect(decoded.channelId).toBe(11)
    expect(decoded.rows).toBe(2)
    expect(decoded.cols).toBe(3)
    expect(decoded.data).toEqual(data)
  })

  test('rejects mismatched data length at encode time', () => {
    expect(() => encodeMatrixFrame(0, { rows: 2, cols: 2, data: new Float32Array(3) })).toThrow(
      VisualizerError,
    )
  })

  test('rejects zero or non-integer dimensions', () => {
    expect(() => encodeMatrixFrame(0, { rows: 0, cols: 1, data: new Float32Array(0) })).toThrow(
      VisualizerError,
    )
    expect(() => encodeMatrixFrame(0, { rows: 1.5, cols: 2, data: new Float32Array(3) })).toThrow(
      VisualizerError,
    )
  })

  test('rejects a decoded payload disagreeing with declared dims', () => {
    const frame = encodeMatrixFrame(0, { rows: 1, cols: 2, data: new Float32Array([1, 2]) })
    expect(() => decodeFrame(frame.slice(0, frame.length - 4))).toThrow(VisualizerError)
  })
})

describe('malformed frames', () => {
  const expectProtocolError = (fn: () => unknown) => {
    try {
      fn()
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(VisualizerError)
      expect((error as VisualizerError).code).toBe('protocol')
    }
  }

  test('rejects truncated headers', () => {
    expectProtocolError(() => decodeFrame(new Uint8Array(0)))
    expectProtocolError(() => decodeFrame(new Uint8Array([1, 1, 0])))
  })

  test('rejects an unknown version', () => {
    expectProtocolError(() => decodeFrame(new Uint8Array([2, 1, 0, 0])))
    expectProtocolError(() => decodeFrame(new Uint8Array([0, 1, 0, 0])))
  })

  test('rejects an unknown kind', () => {
    expectProtocolError(() => decodeFrame(new Uint8Array([1, 0, 0, 0])))
    expectProtocolError(() => decodeFrame(new Uint8Array([1, 4, 0, 0])))
  })

  test('rejects a matrix frame without its prefix', () => {
    expectProtocolError(() => decodeFrame(new Uint8Array([1, 3, 0, 0, 2])))
  })

  test('decodes frames viewing a larger buffer at an offset', () => {
    const inner = encodeBytesFrame(5, new Uint8Array([9, 8, 7]))
    const outer = new Uint8Array(inner.length + 3)
    outer.set(inner, 3)
    const view = outer.subarray(3)
    const decoded = decodeFrame(view)
    if (decoded.kind !== 'bytes') throw new Error('wrong kind')
    expect(decoded.bytes).toEqual(new Uint8Array([9, 8, 7]))
  })
})

describe('text messages', () => {
  test('accepts directory and static messages', () => {
    const directory = parseTextMessage('{"type":"directory","version":1,"channels":[]}')
    expect(directory.type).toBe('directory')
    const stat = parseTextMessage('{"type":"static","id":0,"name":"x","data":null}')
    expect(stat.type).toBe('static')
  })

  test('rejects non-JSON and unknown types', () => {
    expect(() => parseTextMessage('nope')).toThrow(VisualizerError)
    expect(() => parseTextMessage('{"type":"other"}')).toThrow(VisualizerError)
    expect(() => parseTextMessage('42')).toThrow(VisualizerError)
  })
})
