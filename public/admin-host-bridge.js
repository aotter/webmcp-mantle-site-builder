(function installAdminHostBridge() {
  if (window.parent === window) return

  // The iframe boots at /_mantle/admin/index.html, so give the SPA its /admin/dev entry path.
  // Real child routes (/admin/c/*, /admin/views/*, /admin/sign-in, ...) are served the same
  // document by the host Worker and must keep their own path.
  var path = location.pathname
  if (path !== '/admin' && path.indexOf('/admin/') !== 0) history.replaceState(null, '', '/admin/dev')
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
        var nullBodyStatus = event.data.status === 204 || event.data.status === 205 || event.data.status === 304
        resolve(new Response(nullBodyStatus ? null : event.data.body, { status: event.data.status, headers: event.data.headers }))
      }
    })
    window.parent.postMessage({
      protocolVersion: 1,
      type: 'mantle:host-api:request',
      request: { url: url.href, method: request.method, headers: Array.from(request.headers), body: body },
    }, location.origin, [channel.port2])
    return response
  }

  window.addEventListener('message', function refreshFromHost(event) {
    if (event.origin === location.origin && event.source === window.parent && event.data && event.data.type === 'mantle:host-api:reload') {
      location.reload()
    }
  })
})()
