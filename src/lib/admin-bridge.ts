export const maxAdminRequestBodyBytes = 1024 * 1024

const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'])
const allowedPaths = ['/admin/api/', '/api/auth/']

export interface HostApiMessage {
  protocolVersion: 1
  type: 'mantle:host-api:request'
  request: {
    url: string
    method: string
    headers: [string, string][]
    body: ArrayBuffer | null
  }
}

export function isTrustedAdminSource(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  source: MessageEventSource | null,
  origin: string,
): boolean {
  return event.origin === origin && event.source === source
}

export function readHostApiRequest(
  value: unknown,
  origin: string,
): Request {
  if (!isHostApiMessage(value)) throw new TypeError('Admin iframe sent an invalid host request.')

  const url = new URL(value.request.url)
  const method = value.request.method.toUpperCase()
  if (url.origin !== origin || !allowedPaths.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new TypeError('Admin iframe requested an unsupported host route.')
  }
  if (!allowedMethods.has(method)) throw new TypeError('Admin iframe requested an unsupported HTTP method.')
  if (value.request.body && value.request.body.byteLength > maxAdminRequestBodyBytes) {
    throw new TypeError('Admin iframe request body is too large.')
  }
  if ((method === 'GET' || method === 'HEAD') && value.request.body !== null) {
    throw new TypeError(`Admin iframe ${method} requests cannot include a body.`)
  }

  return new Request(url, {
    method,
    headers: value.request.headers,
    ...(value.request.body ? { body: value.request.body } : {}),
  })
}

function isHostApiMessage(value: unknown): value is HostApiMessage {
  if (!isRecord(value) || value.protocolVersion !== 1 || value.type !== 'mantle:host-api:request' || !isRecord(value.request)) return false
  const request = value.request
  return typeof request.url === 'string'
    && typeof request.method === 'string'
    && Array.isArray(request.headers)
    && request.headers.every((header) => Array.isArray(header) && header.length === 2 && header.every((part) => typeof part === 'string'))
    && (request.body === null || request.body instanceof ArrayBuffer)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
