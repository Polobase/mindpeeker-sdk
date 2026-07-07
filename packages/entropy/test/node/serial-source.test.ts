import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { nodeSerialSource, sttyArgs } from '../../src/node/serial-source.js'

describe('sttyArgs', () => {
  test('uses -f on darwin and -F on linux', () => {
    expect(sttyArgs('/dev/cu.usbserial-110', 921_600, 'darwin')).toEqual([
      '-f',
      '/dev/cu.usbserial-110',
      '921600',
      'raw',
      '-echo',
    ])
    expect(sttyArgs('/dev/ttyUSB0', 115_200, 'linux')).toEqual([
      '-F',
      '/dev/ttyUSB0',
      '115200',
      'raw',
      '-echo',
    ])
  })
})

describe('nodeSerialSource', () => {
  test('requires a device path', async () => {
    // @ts-expect-error missing path
    expect(nodeSerialSource({})).rejects.toThrow(TypeError)
  })

  test('maps a failing stty exit to a network EntropyError', async () => {
    const err = (await nodeSerialSource({
      path: '/dev/null',
      sttyPath: '/usr/bin/false',
    }).catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
    expect(err.message).toContain('exited')
  })

  test('maps a missing stty binary to a network EntropyError', async () => {
    const err = (await nodeSerialSource({
      path: '/dev/null',
      sttyPath: '/nonexistent/stty-xyz',
    }).catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
  })
})
