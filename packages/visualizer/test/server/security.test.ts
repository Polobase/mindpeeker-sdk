import { describe, expect, test } from 'bun:test'
import { VisualizerError } from '../../src/errors.js'
import {
  bracketHost,
  isLoopbackHostname,
  resolveServerConfig,
  upgradeRefusal,
} from '../../src/server/security.js'

function serverError(fn: () => unknown): VisualizerError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(VisualizerError)
    expect((error as VisualizerError).code).toBe('server')
    return error as VisualizerError
  }
  throw new Error('expected a VisualizerError')
}

function upgrade(host: string | undefined, origin?: string): Request {
  const headers: Record<string, string> = {}
  if (host !== undefined) headers.host = host
  if (origin !== undefined) headers.origin = origin
  return new Request('http://localhost:4000/ws', { headers })
}

describe('resolveServerConfig', () => {
  test('defaults: ephemeral port on localhost, ring 256, loopback bind', () => {
    const config = resolveServerConfig({})
    expect(config).toMatchObject({
      port: 0,
      host: 'localhost',
      urlHost: 'localhost',
      ringCapacity: 256,
      loopbackBind: true,
    })
    expect(config.allowedOrigins.size).toBe(0)
  })

  test('accepts the port range boundaries', () => {
    expect(resolveServerConfig({ port: 0 }).port).toBe(0)
    expect(resolveServerConfig({ port: 65_535 }).port).toBe(65_535)
  })

  test('rejects ports Bun.serve would silently coerce', () => {
    for (const port of [65_536, 70_000, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY, '8080']) {
      expect(serverError(() => resolveServerConfig({ port })).message).toContain('port')
    }
  })

  test('rejects empty or non-string hosts', () => {
    for (const host of ['', '   ', 42, false]) {
      expect(serverError(() => resolveServerConfig({ host })).message).toContain('host')
    }
  })

  test('rejects invalid ring capacities', () => {
    for (const ringCapacity of [0, -1, 2.5])
      serverError(() => resolveServerConfig({ ringCapacity }))
  })

  test('brackets IPv6 literals for URLs and detects loopback binds', () => {
    expect(resolveServerConfig({ host: '::1' })).toMatchObject({
      urlHost: '[::1]',
      loopbackBind: true,
    })
    expect(resolveServerConfig({ host: '[::1]' })).toMatchObject({
      urlHost: '[::1]',
      loopbackBind: true,
    })
    expect(resolveServerConfig({ host: '127.0.0.1' }).loopbackBind).toBe(true)
    expect(resolveServerConfig({ host: '0.0.0.0' }).loopbackBind).toBe(false)
    expect(resolveServerConfig({ host: '::' })).toMatchObject({
      urlHost: '[::]',
      loopbackBind: false,
    })
  })

  test('normalizes allowed origins and records their hostnames', () => {
    const config = resolveServerConfig({
      allowedOrigins: ['https://Lab.Example', 'http://viz.local:8080/', 'https://lab.example:443'],
    })
    expect([...config.allowedOrigins].sort()).toEqual([
      'http://viz.local:8080',
      'https://lab.example',
    ])
    expect([...config.allowedHostnames].sort()).toEqual(['lab.example', 'viz.local'])
  })

  test('rejects allowedOrigins that are not bare origins', () => {
    for (const allowedOrigins of [
      'https://lab.example',
      ['lab.example'],
      ['https://lab.example/viz'],
      ['https://lab.example/?q=1'],
      ['https://user@lab.example'],
      ['null'],
      [42],
    ]) {
      serverError(() => resolveServerConfig({ allowedOrigins }))
    }
  })
})

describe('host helpers', () => {
  test('bracketHost only brackets bare IPv6 literals', () => {
    expect(bracketHost('::1')).toBe('[::1]')
    expect(bracketHost('[::1]')).toBe('[::1]')
    expect(bracketHost('localhost')).toBe('localhost')
    expect(bracketHost('10.0.0.2')).toBe('10.0.0.2')
  })

  test('isLoopbackHostname', () => {
    for (const h of [
      'localhost',
      'LOCALHOST',
      'viz.localhost',
      '127.0.0.1',
      '127.1.2.3',
      '[::1]',
    ]) {
      expect(isLoopbackHostname(h)).toBe(true)
    }
    for (const h of [
      'evil.example',
      '128.0.0.1',
      '127.0.0.1.evil.example',
      'localhost.evil',
      '0.0.0.0',
    ]) {
      expect(isLoopbackHostname(h)).toBe(false)
    }
  })
})

describe('upgradeRefusal', () => {
  const loopback = resolveServerConfig({})
  const proxied = resolveServerConfig({ allowedOrigins: ['https://lab.example'] })
  const lan = resolveServerConfig({ host: '0.0.0.0' })

  test('accepts non-browser clients without an Origin header', () => {
    expect(upgradeRefusal(upgrade('localhost:4000'), loopback)).toBeUndefined()
  })

  test('accepts same-host pages, including other loopback spellings', () => {
    expect(
      upgradeRefusal(upgrade('localhost:4000', 'http://localhost:4000'), loopback),
    ).toBeUndefined()
    expect(
      upgradeRefusal(upgrade('127.0.0.1:4000', 'http://127.0.0.1:4000'), loopback),
    ).toBeUndefined()
    expect(upgradeRefusal(upgrade('[::1]:4000', 'http://[::1]:4000'), loopback)).toBeUndefined()
  })

  test('refuses cross-site pages (cross-site WebSocket hijacking)', () => {
    expect(upgradeRefusal(upgrade('localhost:4000', 'https://evil.example'), loopback)).toContain(
      'origin',
    )
    // another local port is another origin
    expect(upgradeRefusal(upgrade('localhost:4000', 'http://localhost:3000'), loopback)).toContain(
      'origin',
    )
    expect(upgradeRefusal(upgrade('localhost:4000', 'null'), loopback)).toContain('Origin')
  })

  test('refuses a DNS-rebinding page whose Host names its own domain on a loopback bind', () => {
    const refusal = upgradeRefusal(
      upgrade('evil.example:4000', 'http://evil.example:4000'),
      loopback,
    )
    expect(refusal).toContain('host evil.example')
    // …but a LAN bind cannot know its public names, so only the Origin rule applies
    expect(upgradeRefusal(upgrade('pi.lan:4000', 'http://pi.lan:4000'), lan)).toBeUndefined()
  })

  test('allowedOrigins admit a reverse-proxied page and its forwarded Host', () => {
    expect(upgradeRefusal(upgrade('lab.example', 'https://lab.example'), proxied)).toBeUndefined()
    expect(
      upgradeRefusal(upgrade('localhost:4000', 'https://lab.example'), proxied),
    ).toBeUndefined()
    expect(upgradeRefusal(upgrade('lab.example', 'https://other.example'), proxied)).toBeDefined()
  })

  test('a missing Host header is refused', () => {
    expect(upgradeRefusal(upgrade(undefined), loopback)).toContain('Host')
  })
})
