import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBatchApi} from '../cloudflare/ocr-batch-api.js';

// This regression suite must never touch D1, R2, Queue or paid OCR inference.
const origin = 'https://preview.example.test';
const jobId = '11111111-1111-4111-8111-111111111111';
const actor = 'a'.repeat(32);
const endpoints = [
  ['/api/ocr/jobs', 'create'],
  [`/api/ocr/jobs/${jobId}/resume`, 'resume'],
  [`/api/ocr/jobs/${jobId}/retry`, 'retry']
];

for (const flag of [undefined, 'false', 'TRUE']) {
  test(`OCR batch remains disabled for flag ${String(flag)}`, async () => {
    let externalCalls = 0;
    const forbidden = () => { externalCalls++; throw Error('Unexpected external operation'); };
    const env = {
      OCR_BATCH_ENABLED: flag,
      SECURITY_DB: {prepare: forbidden},
      OCR_JOB_ASSETS: {put: forbidden},
      OCR_QUEUE: {send: forbidden}
    };
    for (const [path, action] of endpoints) {
      const url = new URL(path, origin);
      const request = new Request(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: '{}'
      });
      const response = await handleBatchApi(request, env, actor, url);
      assert.equal(response.status, 503, `${action} must fail closed`);
      assert.deepEqual(await response.json(), {error: 'BATCH_DISABLED'});
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(externalCalls, 0, 'Disabled operations must not query DB, store bytes, or enqueue work');
  });
}
