(function installAdminHostBridge() {
  if (window.parent === window) return

  history.replaceState(null, '', '/admin/dev')
  var networkFetch = window.fetch.bind(window)
  window.fetch = async function hostFetch(input, init) {
    var request = new Request(input, init)
    var url = new URL(request.url)
    if (url.origin !== location.origin || (!url.pathname.startsWith('/admin/api/') && !url.pathname.startsWith('/api/auth/'))) {
      return networkFetch(input, init)
    }

    var channel = new MessageChannel()
    var body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer()
    var response = new Promise(function waitForHost(resolve, reject) {
      var timeout = setTimeout(function onTimeout() {
        channel.port1.close()
        reject(new TypeError('Admin API request timed out.'))
      }, 10000)
      channel.port1.onmessage = function onResponse(event) {
        clearTimeout(timeout)
        channel.port1.close()
        if (!event.data || event.data.ok !== true) {
          reject(new TypeError(event.data && event.data.error || 'Admin API request failed.'))
          return
        }
        resolve(new Response(event.data.body, { status: event.data.status, headers: event.data.headers }))
      }
    })
    window.parent.postMessage({
      protocolVersion: 1,
      type: 'mantle:host-api:request',
      request: { url: url.href, method: request.method, headers: Array.from(request.headers), body: body },
    }, location.origin, [channel.port2])
    return response
  }
})()
