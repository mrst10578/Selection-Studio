import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handleQuestionApi} from '../cloudflare/question-api-v1.js';

const schemas=await Promise.all([
 'schema-security.sql',
 'schema-question-bank-v1.sql'
].map(name=>readFile(new URL('../cloudflare/'+name,import.meta.url),'utf8')));
const actor='a'.repeat(32);
const endpoint='https://preview.example/api/v1/projects';

test('project writes require the exact JSON media type, with charset parameters allowed',async()=>{
 const local=new DatabaseSync(':memory:');
 try{
  local.exec('PRAGMA foreign_keys=ON;');
  for(const schema of schemas)local.exec(schema);
  const env={SECURITY_DB:{prepare(sql){return{bind(...args){
   const statement=local.prepare(sql);
   return{
    async first(){return statement.get(...args)??null},
    async all(){return {results:statement.all(...args)}},
    async run(){return statement.run(...args)}
   };
  }}}}};
  const post=async(contentType,body)=>{
   const url=new URL(endpoint);
   const request=new Request(url,{method:'POST',headers:{'Content-Type':contentType},body});
   const response=await handleQuestionApi(request,env,actor,url);
   return {status:response.status,data:await response.json()};
  };
  const counts=()=>({
   projects:local.prepare('SELECT COUNT(*) AS n FROM bank_projects').get().n,
   audits:local.prepare('SELECT COUNT(*) AS n FROM security_audit').get().n
  });
  for(const type of ['application/jsonp','application/jsonx','application/json, text/plain','text/plain']){
   const result=await post(type,JSON.stringify({name:'نمونه'}));
   assert.equal(result.status,400,type);
   assert.equal(result.data.error,'JSON_REQUIRED',type);
   assert.deepEqual(counts(),{projects:0,audits:0},'rejected media type must not mutate D1');
  }
  const malformed=await post('application/json; charset=utf-8','{invalid');
  assert.equal(malformed.status,400);
  assert.equal(malformed.data.error,'INVALID_JSON','charset parameter should pass the media-type check');
  assert.deepEqual(counts(),{projects:0,audits:0});
  const accepted=await post('Application/JSON; charset=UTF-8',JSON.stringify({name:'پروژه آزمایشی'}));
  assert.equal(accepted.status,201,'case-insensitive JSON media type with charset remains valid');
  assert.equal(accepted.data.name,'پروژه آزمایشی');
  assert.deepEqual(counts(),{projects:1,audits:1});
 }finally{
  local.close();
 }
});
