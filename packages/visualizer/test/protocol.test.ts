import { describe, expect, test } from 'bun:test'
import { VisualizerError } from '../src/errors.js'
import {
  BANDS_PREFIX_BYTES,
  decodeFrame,
  encodeBytesFrame,
  encodeMatrixFrame,
  encodeSeriesFrame,
  FRAME_KIND,
  HEADER_BYTES,
  isSupportedProtocolVersion,
  isValidRange,
  MAX_SERIES_BANDS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  parseTextMessage,
  SERIES_POINT_BYTES,
} from '../src/protocol.js'
import type { SeriesPoint } from '../src/types.js'
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

  test('header layout is exactly [layout version 1, kind, u16 LE id]', () => {
    const frame = encodeBytesFrame(0x1234, new Uint8Array([0xaa]))
    expect(frame[0]).toBe(1)
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

describe('multi-band series frames (protocol 2, kind 4)', () => {
  const inf = Number.POSITIVE_INFINITY
  const points: SeriesPoint[] = [
    {
      t: 1,
      value: -0.5,
      bands: [
        { lo: -0.99, hi: 2.84 },
        { lo: -inf, hi: 9.92 },
      ],
    },
    {
      t: 2,
      value: 0.1 + 0.2,
      bands: [
        { lo: -1.9, hi: 3.99 },
        { lo: Number.NaN, hi: 12.5 },
      ],
    },
  ]

  test('round-trips several bands per point bit-exactly, NaN and ±∞ included', () => {
    const frame = encodeSeriesFrame(0x0203, points)
    expect([frame[0], frame[1]]).toEqual([2, FRAME_KIND.bands])
    expect(new DataView(frame.buffer).getUint16(HEADER_BYTES, true)).toBe(2)
    expect(frame.byteLength).toBe(HEADER_BYTES + BANDS_PREFIX_BYTES + 2 * 16 * 3)
    const decoded = decodeFrame(frame)
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.channelId).toBe(0x0203)
    expect(decoded.points).toEqual(points)
    expect(Object.is(decoded.points[1]?.value, 0.1 + 0.2)).toBe(true)
    expect(decoded.points[0]?.bands?.[1]?.lo).toBe(-inf)
    expect(Number.isNaN(decoded.points[1]?.bands?.[1]?.lo)).toBe(true)
  })

  test('labels are not encoded; shorter band lists and a single band are NaN-padded', () => {
    const decoded = decodeFrame(
      encodeSeriesFrame(1, [
        {
          t: 0,
          value: 1,
          bands: [
            { lo: 0, hi: 1, label: 'pointwise' },
            { lo: 2, hi: 3 },
          ],
        },
        { t: 1, value: 2, band: [4, 5] },
        { t: 2, value: 3 },
      ]),
    )
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.points[0]?.bands).toEqual([
      { lo: 0, hi: 1 },
      { lo: 2, hi: 3 },
    ])
    expect(decoded.points[1]?.bands).toEqual([
      { lo: 4, hi: 5 },
      { lo: Number.NaN, hi: Number.NaN },
    ])
    expect(decoded.points[2]?.bands).toEqual([
      { lo: Number.NaN, hi: Number.NaN },
      { lo: Number.NaN, hi: Number.NaN },
    ])
  })

  test('version 1 downgrades to kind 2 carrying the first band', () => {
    const frame = encodeSeriesFrame(5, points, { version: 1 })
    expect([frame[0], frame[1]]).toEqual([1, FRAME_KIND.series])
    const decoded = decodeFrame(frame)
    if (decoded.kind !== 'series') throw new Error('wrong kind')
    expect(decoded.points).toEqual([
      { t: 1, value: -0.5, band: [-0.99, 2.84] },
      { t: 2, value: 0.1 + 0.2, band: [-1.9, 3.99] },
    ])
  })

  test('points without bands keep the kind-2 layout at every version', () => {
    const plain = [{ t: 0, value: 1, band: [0, 2] as const }]
    expect(encodeSeriesFrame(0, plain)).toEqual(encodeSeriesFrame(0, plain, { version: 1 }))
    expect(encodeSeriesFrame(0, plain)[0]).toBe(1)
  })

  const protocolCode = (fn: () => unknown): string => {
    try {
      fn()
    } catch (error) {
      expect(error).toBeInstanceOf(VisualizerError)
      return (error as VisualizerError).code
    }
    throw new Error('expected a throw')
  }

  test('malformed bands are rejected at encode time', () => {
    const bad: unknown[] = [
      { t: 0, value: 0, band: [0, 1], bands: [{ lo: 0, hi: 1 }] },
      { t: 0, value: 0, bands: [] },
      {
        t: 0,
        value: 0,
        bands: Array.from({ length: MAX_SERIES_BANDS + 1 }, () => ({ lo: 0, hi: 1 })),
      },
      { t: 0, value: 0, bands: [{ lo: '0', hi: 1 }] },
      { t: 0, value: 0, bands: [null] },
      { t: 0, value: 0, bands: [{ lo: 0, hi: 1, label: 7 }] },
    ]
    for (const point of bad) {
      expect(protocolCode(() => encodeSeriesFrame(0, [point as SeriesPoint]))).toBe('protocol')
    }
  })

  test('decoding checks the layout byte, band count and point size', () => {
    const good = encodeSeriesFrame(0, points)
    const relabeled = good.slice()
    relabeled[0] = 1 // kind 4 needs layout version 2
    expect(protocolCode(() => decodeFrame(relabeled))).toBe('protocol')
    expect(protocolCode(() => decodeFrame(good.slice(0, good.length - 8)))).toBe('protocol')
    expect(protocolCode(() => decodeFrame(new Uint8Array([2, 4, 0, 0, 1])))).toBe('protocol')
    for (const count of [0, MAX_SERIES_BANDS + 1]) {
      const frame = good.slice()
      new DataView(frame.buffer).setUint16(HEADER_BYTES, count, true)
      expect(protocolCode(() => decodeFrame(frame))).toBe('protocol')
    }
    // a kind-2 frame claiming layout 2 is rejected too
    const series = encodeSeriesFrame(0, [{ t: 0, value: 0 }])
    series[0] = 2
    expect(protocolCode(() => decodeFrame(series))).toBe('protocol')
  })
})

describe('protocol versions', () => {
  test('this build speaks versions 1 and 2', () => {
    expect([MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]).toEqual([1, 2])
    expect([0, 1, 2, 3, 1.5, '2', Number.NaN].map(isSupportedProtocolVersion)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
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
    expectProtocolError(() => decodeFrame(new Uint8Array([3, 4, 0, 0, 1, 0])))
  })

  test('rejects an unknown kind', () => {
    expectProtocolError(() => decodeFrame(new Uint8Array([1, 0, 0, 0])))
    expectProtocolError(() => decodeFrame(new Uint8Array([1, 4, 0, 0])))
    expectProtocolError(() => decodeFrame(new Uint8Array([2, 5, 0, 0])))
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
    expect(() => parseTextMessage('[{"type":"directory"}]')).toThrow(VisualizerError)
  })

  const protocolMessage = (text: string): string => {
    try {
      parseTextMessage(text)
    } catch (error) {
      expect(error).toBeInstanceOf(VisualizerError)
      expect((error as VisualizerError).code).toBe('protocol')
      return (error as VisualizerError).message
    }
    throw new Error(`accepted ${text}`)
  }
  const directory = (channels: unknown, version: unknown = PROTOCOL_VERSION) =>
    JSON.stringify({ type: 'directory', version, channels })
  const entry = { id: 0, name: 'noise', kind: 'bytes', status: 'live' }

  test('a directory needs an integer version and a channels array', () => {
    expect(protocolMessage('{"type":"directory"}')).toContain('version')
    expect(protocolMessage('{"type":"directory","version":1}')).toContain('channels')
    expect(protocolMessage(directory([], 1.5))).toContain('version')
    expect(protocolMessage(directory({}))).toContain('channels')
  })

  test('directory entries are validated field by field', () => {
    const cases: [unknown, string][] = [
      [42, 'not an object'],
      [{ ...entry, id: -1 }, 'id'],
      [{ ...entry, id: 70_000 }, 'id'],
      [{ ...entry, id: '0' }, 'id'],
      [{ ...entry, name: 3 }, 'name'],
      [{ ...entry, kind: 'video' }, 'kind'],
      [{ ...entry, status: 'paused' }, 'status'],
      [{ ...entry, rowLabels: [1] }, 'rowLabels'],
      [{ ...entry, colLabels: 'a,b' }, 'colLabels'],
      [{ ...entry, range: [1, 1] }, 'range'],
      [{ ...entry, range: [0] }, 'range'],
      [{ ...entry, error: { message: 'x' } }, 'error'],
      [{ ...entry, bandLabels: ['ok', 3] }, 'bandLabels'],
      [{ ...entry, note: 42 }, 'note'],
    ]
    for (const [bad, field] of cases) expect(protocolMessage(directory([bad]))).toContain(field)
  })

  test('a valid directory with every optional field parses, at both versions', () => {
    const full = {
      ...entry,
      kind: 'matrix',
      status: 'error',
      rowLabels: ['r'],
      colLabels: ['a', 'b'],
      range: [0, 160],
      error: 'device unplugged',
      note: 'health_test: 1 failure',
    }
    const banded = { ...entry, id: 1, kind: 'series', bandLabels: ['pointwise', ''] }
    for (const version of [MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]) {
      expect(parseTextMessage(directory([entry, full, banded], version)) as unknown).toEqual({
        type: 'directory',
        version,
        channels: [entry, full, banded],
      })
    }
  })

  test('an unsupported-version directory is returned unchecked so the client can report the mismatch', () => {
    for (const version of [0, PROTOCOL_VERSION + 1]) {
      const message = parseTextMessage(directory([{ something: 'new' }], version))
      expect(message.type === 'directory' && message.version).toBe(version)
    }
  })

  test('a static message needs a u16 id, a string name and data', () => {
    expect(protocolMessage('{"type":"static","name":"x","data":1}')).toContain('id')
    expect(protocolMessage('{"type":"static","id":0,"data":1}')).toContain('name')
    expect(protocolMessage('{"type":"static","id":0,"name":"x"}')).toContain('data')
  })
})

describe('isValidRange', () => {
  test('accepts finite [lo, hi] with lo < hi only', () => {
    expect(isValidRange([0, 1])).toBe(true)
    expect(isValidRange([-3.5, -3.25])).toBe(true)
    for (const bad of [
      [1, 1],
      [2, 1],
      [0, Number.POSITIVE_INFINITY],
      [Number.NaN, 1],
      [0],
      [0, 1, 2],
      '0,1',
      null,
    ]) {
      expect(isValidRange(bad)).toBe(false)
    }
  })
})
