// Cloudflare Pages advanced-mode Worker.
// Static files are served from this deployment's own assets, not GitHub Pages.
const OCR_ORIGIN = "https://examforge-free-ocr.zh-st-2.workers.dev/ocr";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ok: true, service: "selection-studio", hosting: "Cloudflare Pages", assets: "native"});
    }
    if (url.pathname === "/api/ocr") {
      if (request.method !== "POST") {
        return Response.json({error: "Method not allowed"}, {status: 405, headers: {"Allow": "POST"}});
      }
      // Transitional API: user-supplied OCR token remains required until
      // server-side identity and authorization are implemented.
      const auth = request.headers.get("Authorization") || "";
      if (!/^Bearer [^\s]+$/.test(auth)) {
        return Response.json({error: "OCR authorization required"}, {status: 401});
      }
      const upstream = await fetch(OCR_ORIGIN, {
        method: "POST",
        headers: {"Authorization": auth, "Content-Type": "application/json"},
        body: request.body,
        signal: request.signal
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
      });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({error: "Unknown API endpoint"}, {status: 404});
    }
    if (url.pathname === "/ocr") {
      return Response.redirect(url.origin + "/admin/ocr-studio.html", 302);
    }
    // Preserve legacy root URLs and current admin/studio paths.
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const assetUrl = new URL(path + url.search, url.origin);
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
};
