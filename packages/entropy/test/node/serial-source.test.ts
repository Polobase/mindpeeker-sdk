import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { nodeSerialSource, sttyArgs } from '../../src/node/serial-source.js'

describe('sttyArgs', () => {
  test('uses -f on darwin and -F on linux, raw 8N1 with clocal and no flow control', () => {
    const tail = ['raw', '-echo', 'clocal', 'cs8', '-parenb', '-cstopb', '-crtscts']
    expect(sttyArgs('/dev/cu.usbserial-110', 921_600, 'darwin')).toEqual([
      '-f',
      '/dev/cu.usbserial-110',
      '921600',
      ...tail,
    ])
    expect(sttyArgs('/dev/ttyUSB0', 115_200, 'linux')).toEqual([
      '-F',
      '/dev/ttyUSB0',
      '115200',
      ...tail,
    ])
  })
})

describe('nodeSerialSource', () => {
  test('requires a device path (invalid_request)', async () => {
    // @ts-expect-error missing path
    const err = (await nodeSerialSource({}).catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('invalid_request')
  })

  test('rejects an invalid baud rate', async () => {
    const err = (await nodeSerialSource({ path: '/dev/null', baudRate: 0 }).catch(
      (e) => e,
    )) as EntropyError
    expect(err.code).toBe('invalid_request')
  })

  test('maps a missing device to network with the ENOENT cause', async () => {
    const err = (await nodeSerialSource({ path: '/nonexistent/ttyUSB9' }).catch(
      (e) => e,
    )) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
    expect((err.cause as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect(err.message).toContain('no such device')
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

  test('opens, configures and streams the device until it ends', async () => {
    const source = await nodeSerialSource({ path: '/dev/null', sttyPath: '/usr/bin/true' })
    const chunks: Uint8Array[] = []
    for await (const chunk of source) chunks.push(chunk)
    expect(chunks).toEqual([]) // /dev/null is an immediate EOF
    source.close()
  })
})
