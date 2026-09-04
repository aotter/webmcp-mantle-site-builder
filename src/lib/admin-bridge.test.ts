import { describe, expect, it } from 'vitest'

import { isTrustedAdminSource, maxAdminRequestBodyBytes, readHostApiRequest, type HostApiMessage } from './admin-bridge'

const origin = 'https://builder.test'

function message(overrides: Partial<HostApiMessage> = {}): HostApiMessage {
  return {
    protocolVersion: 1,
    type: 'mantle:host-api:request',
    request: { url: `${origin}/admin/api/developer-console`, method: 'GET', headers: [], body: null },
    ...overrides,
  }
}

describe('trusted Admin iframe bridge', () => {
  it('accepts only the current source and origin', () => {
    const source = {} as MessageEventSource
    expect(isTrustedAdminSource({ source, origin }, source, origin)).toBe(true)
    expect(isTrustedAdminSource({ source: {} as MessageEventSource, origin }, source, origin)).toBe(false)
    expect(isTrustedAdminSource({ source, origin: 'https://attacker.test' }, source, origin)).toBe(false)
  })

  it('accepts current Admin and auth requests', async () => {
    expect(readHostApiRequest(message(), origin).url).toBe(`${origin}/admin/api/developer-console`)
    const body = new TextEncoder().encode('{"name":"Ada"}').buffer
    const request = readHostApiRequest(message({
      request: { url: `${origin}/api/auth/session`, method: 'POST', headers: [['content-type', 'application/json']], body },
    }), origin)
    expect(request.method).toBe('POST')
    await expect(request.text()).resolves.toBe('{"name":"Ada"}')
  })

  it('rejects unsupported routes and methods, and oversized bodies', () => {
    expect(() => readHostApiRequest(message({ request: { url: `${origin}/api/health`, method: 'GET', headers: [], body: null } }), origin)).toThrow('route')
    expect(() => readHostApiRequest(message({ request: { url: 'https://attacker.test/admin/api/x', method: 'GET', headers: [], body: null } }), origin)).toThrow('route')
    expect(() => readHostApiRequest(message({ request: { url: `${origin}/admin/api/x`, method: 'TRACE', headers: [], body: null } }), origin)).toThrow('method')
    expect(() => readHostApiRequest(message({ request: { url: `${origin}/admin/api/x`, method: 'POST', headers: [], body: new ArrayBuffer(maxAdminRequestBodyBytes + 1) } }), origin)).toThrow('too large')
    expect(() => readHostApiRequest(message({ request: { url: `${origin}/admin/api/x`, method: 'GET', headers: [], body: new ArrayBuffer(1) } }), origin)).toThrow('cannot include a body')
  })
})
