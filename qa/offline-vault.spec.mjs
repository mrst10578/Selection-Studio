import {test,expect} from '@playwright/test';
test.describe('ZH-84 encrypted offline draft vault',()=>{
 test('retains only encrypted ciphertext, requires passphrase and isolates actors',async({page})=>{
  await page.goto('/studio/');
  const result=await page.evaluate(async()=>{
   const m=await import('/studio/offline-encrypted-vault.js');
   const draft={projectId:'p-1',questionId:'q-1',baseRevision:2,sourceFingerprint:'pdf_digest',questionText:'سؤال محرمانه ۱۴۰۵',answerText:'پاسخ محرمانه'};
   const saved=await m.saveOfflineDraft('operator@example.test','a-strong-passphrase',draft);
   const all=await m.listOfflineDrafts('operator@example.test');
   let wrong='';
   try{await m.readOfflineDraft('operator@example.test','not-the-password',saved.id)}catch(e){wrong=e.message}
   const content=await m.readOfflineDraft('operator@example.test','a-strong-passphrase',saved.id);
   const other=await m.listOfflineDrafts('different@example.test');
   const deleted=await m.deleteOfflineDraft('operator@example.test',saved.id);
   return {saved,all,wrong,content,other,deleted,remaining:await m.listOfflineDrafts('operator@example.test')};
  });
  expect(result.saved.encrypted).toBe(true);
  expect(result.all).toHaveLength(1);
  expect(JSON.stringify(result.all)).not.toContain('سؤال محرمانه');
  expect(result.wrong).toBe('OFFLINE_DECRYPTION_FAILED');
  expect(result.content.questionText).toContain('۱۴۰۵');
  expect(result.other).toEqual([]);
  expect(result.deleted).toBe(true);
  expect(result.remaining).toEqual([]);
 });
 test('rejects weak passphrases without returning a successful offline save',async({page})=>{
  await page.goto('/studio/');
  const code=await page.evaluate(async()=>{
   const m=await import('/studio/offline-encrypted-vault.js');
   try{await m.saveOfflineDraft('operator@example.test','short',{projectId:'p',baseRevision:1,questionText:'Q'})}
   catch(e){return e.message}
  });
  expect(code).toBe('STRONG_PASSPHRASE_REQUIRED');
 });
});
