export function createReviewApi({getWorkerUrl,getAdminKey}){
  async function request(path,{method="GET",body}={}){
    const base=String(getWorkerUrl()||"").replace(/\/$/,"");
    if(!base)throw new Error("Worker URL تنظیم نشده است.");
    const response=await fetch(base+path,{method,headers:{"content-type":"application/json","x-testbank-admin-key":getAdminKey()||""},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!response.ok)throw new Error(typeof data==="string"?data:(data?.error||("HTTP "+response.status)));
    return data;
  }
  async function source(batchId,questionId,kind){
    const base=String(getWorkerUrl()||"").replace(/\/$/,"");
    const url=base+"/studio/admin/source?batch_id="+encodeURIComponent(batchId)+"&question_id="+encodeURIComponent(questionId)+"&kind="+encodeURIComponent(kind);
    const response=await fetch(url,{headers:{"x-testbank-admin-key":getAdminKey()||""}});
    if(!response.ok)throw new Error((await response.text())||("HTTP "+response.status));
    return response.blob();
  }
  return {
    source,
    list:status=>request("/studio/admin/list?status="+encodeURIComponent(status)),
    batch:(status,id)=>request("/studio/admin/batch?status="+encodeURIComponent(status)+"&id="+encodeURIComponent(id)),
    save:batch=>request("/studio/admin/save",{method:"POST",body:{batch}}),
    publish:(batchId,reviewer)=>request("/studio/admin/publish",{method:"POST",body:{batch_id:batchId,reviewer}}),
    reject:(batchId,reviewer,note)=>request("/studio/admin/reject",{method:"POST",body:{batch_id:batchId,reviewer,note}}),
    restore:(batchId,reviewer)=>request("/studio/admin/restore",{method:"POST",body:{batch_id:batchId,reviewer}}),
    lock:(batchId,reviewer)=>request("/studio/admin/lock",{method:"POST",body:{batch_id:batchId,reviewer}}),
    unlock:(batchId,reviewer)=>request("/studio/admin/unlock",{method:"POST",body:{batch_id:batchId,reviewer}})
  };
}
