import {createServer} from "node:http";
import {readFile,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const PORT=Number(process.env.PORT||4173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".webp":"image/webp",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg"};

createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://localhost");
    let pathname=decodeURIComponent(url.pathname);
    if(pathname==="/")pathname="/studio/";
    if(pathname==="/admin")pathname="/review-console/";
    else if(pathname.startsWith("/admin/"))pathname="/review-console/"+pathname.slice("/admin/".length);
    let target=path.resolve(ROOT,"."+pathname);
    if(!target.startsWith(ROOT)){res.writeHead(403);res.end("Forbidden");return}
    let info=await stat(target).catch(()=>null);
    if(info?.isDirectory()){target=path.join(target,"index.html");info=await stat(target).catch(()=>null)}
    if(!info?.isFile()&&!pathname.startsWith("/studio/")&&!pathname.startsWith("/review-console/")&&!pathname.startsWith("/admin/")){
      const studioTarget=path.resolve(ROOT,"./studio"+pathname);
      if(studioTarget.startsWith(path.join(ROOT,"studio"))){
        const studioInfo=await stat(studioTarget).catch(()=>null);
        if(studioInfo?.isFile()){target=studioTarget;info=studioInfo}
      }
    }
    if(!info?.isFile()){res.writeHead(404);res.end("Not found");return}
    const body=await readFile(target),type=types[path.extname(target).toLowerCase()]||"application/octet-stream";
    res.writeHead(200,{"content-type":type,"cache-control":"no-store"});res.end(body);
  }catch(err){res.writeHead(500);res.end(String(err?.message||err))}
}).listen(PORT,"127.0.0.1",()=>console.log("QA server http://127.0.0.1:"+PORT));
