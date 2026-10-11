// Cloudflare Pages advanced-mode Worker. Fail closed for OCR until server credentials are configured.
const OCR_ORIGIN = "https://examforge-free-ocr.zh-st-2.workers.dev/ocr";
const json = (body,status=200,headers={}) => Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==="/health") return json({ok:true,service:"selection-studio",hosting:"Cloudflare Pages"});
    if(url.pathname==="/api/ocr") {
      if(request.method!=="POST") return json({error:"Method not allowed"},405,{"Allow":"POST"});
      // Never forward browser-supplied credentials to the OCR upstream.
      if(!env.OCR_SERVICE_TOKEN || !env.OCR_ACCESS_AUD) return json({error:"OCR service not configured"},503);
      // Cloudflare Access JWT must be verified server-side before allowing OCR.
      // This route deliberately fails closed until the verification integration is deployed.
      return json({error:"OCR requires verified server-side identity"},403);
    }
    if(url.pathname.startsWith("/api/")) return json({error:"Unknown API endpoint"},404);
    if(url.pathname==="/ocr") return Response.redirect(url.origin+"/admin/ocr-studio.html",302);
    if(!env.ASSETS) return json({error:"Asset binding unavailable"},503);
    const path=url.pathname==="/" ? "/index.html":url.pathname;
    return env.ASSETS.fetch(new Request(new URL(path+url.search,url.origin),request));
  }
};
