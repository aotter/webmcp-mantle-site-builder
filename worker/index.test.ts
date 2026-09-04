import { expect, test } from 'vitest'

import worker from './index.js'

const env = {
  ASSETS: { fetch: (url: URL) => Promise.resolve(new Response(url.pathname)) },
} as unknown as Env

function get(path: string): Promise<Response> {
  return Promise.resolve(worker.fetch(new Request(`https://builder.test${path}`), env))
}

test('admin document navigations serve the Mantle Admin SPA document', async () => {
  for (const path of ['/admin', '/admin/dev', '/admin/c/posts', '/admin/views/all', '/admin/sign-in?return=%2Fadmin']) {
    expect(await (await get(path)).text()).toBe('/_mantle/admin/index.html')
  }
})

test('admin api requests are left to the host bridge', async () => {
  expect((await get('/admin/api/entries')).status).toBe(404)
})

test('health endpoint still answers', async () => {
  expect((await get('/api/health')).status).toBe(200)
})

test('MCP routes fail with an actionable preview diagnostic', async () => {
  for (const path of ['/mcp', '/mcp/staff']) {
    const response = await get(path)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'preview_connection_unavailable' })
  }
})
