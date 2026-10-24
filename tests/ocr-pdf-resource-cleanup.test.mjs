import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the browser's actual importPdf function without loading its DOM-heavy module.
const source=readFileSync(new URL('../review-console/ocr-studio.js',import.meta.url),'utf8');
const start=source.indexOf('async function importPdf(file){');
const end=source.indexOf('\n$("images").onchange',start);
assert.ok(start>=0&&end>start,'importPdf implementation should be present');

const makeImportPdf=doc=>new Function(
 'loadPdf','notice','digits','addBlob',
 source.slice(start,end)+'\nreturn importPdf;'
)(
 async()=>({getDocument:()=>({promise:Promise.resolve(doc)})}),
 ()=>{},String,async()=>{}
);
const file={name:'questions.pdf',arrayBuffer:async()=>new ArrayBuffer(0)};

test('oversized PDFs release their PDF.js document on rejection',async()=>{
 let destroyed=0;
 const importPdf=makeImportPdf({numPages:51,async destroy(){destroyed++}});
 await assert.rejects(importPdf(file),/۵۰ صفحه/);
 assert.equal(destroyed,1);
});

test('PDF.js document is released when page rendering fails',async()=>{
 let destroyed=0;
 const importPdf=makeImportPdf({
  numPages:1,
  async getPage(){throw new Error('render failed')},
  async destroy(){destroyed++}
 });
 await assert.rejects(importPdf(file),/render failed/);
 assert.equal(destroyed,1);
});

test('successful empty PDF import releases the document',async()=>{
 let destroyed=0;
 const importPdf=makeImportPdf({numPages:0,async destroy(){destroyed++}});
 assert.equal(await importPdf(file),0);
 assert.equal(destroyed,1);
});
