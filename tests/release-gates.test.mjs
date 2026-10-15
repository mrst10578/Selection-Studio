import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const deployment=await readFile(new URL('../.github/workflows/deploy-cloudflare-pages.yml',import.meta.url),'utf8');
const worker=await readFile(new URL('../cloudflare/_worker.js',import.meta.url),'utf8');

test('production Pages release requires explicit main-branch workflow dispatch and release QA',()=>{
 assert.match(deployment,/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*release_production:/);
 assert.match(deployment,/deploy:\s*\n\s*needs: \[validate, release-qa\]/);
 assert.match(deployment,/if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.release_production == true/);
 assert.match(deployment,/release-qa:\s*\n\s*needs: validate/);
 assert.match(deployment,/npm run qa:ui/);
 assert.match(deployment,/npm run qa:lighthouse/);
 assert.doesNotMatch(deployment,/if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
});

test('PR preview uses separate deployment path and skips safely without repository secrets',()=>{
 assert.match(deployment,/deploy-preview:/);
 assert.match(deployment,/steps\.credentials\.outputs\.enabled == 'true'/);
 assert.match(deployment,/--branch="\$\{\{ github\.head_ref \}\}"/);
 assert.match(deployment,/if: github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
 assert.match(worker,/url\.pathname==="\/api\/readiness"/);
 assert.match(worker,/if\(!operator&&url\.pathname!=="\/api\/session"\)/);
});
