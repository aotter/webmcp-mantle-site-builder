export default {
  fetch(request, env) {
    const url = new URL(request.url);

    // Mantle Admin is a client-side SPA mounted at /admin/*: serve its own
    // index.html for document navigations so /admin/c/*, /admin/views/*,
    // /admin/sign-in etc. keep working instead of hitting the Builder SPA.
    // ponytail: /admin/api/* stays a 404 here; the iframe bridge postMessages those to the host.
    if ((url.pathname === "/admin" || url.pathname.startsWith("/admin/")) && !url.pathname.startsWith("/admin/api/")) {
      return env.ASSETS.fetch(new URL("/_mantle/admin/index.html", url));
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "webmcp-mantle-site-builder",
      });
    }

    if (url.pathname === "/mcp" || url.pathname === "/mcp/staff") {
      return Response.json({
        error: "preview_connection_unavailable",
        message: "External MCP connections are unavailable in the Builder sandbox. Deploy the generated project first.",
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
		return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
