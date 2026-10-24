import test from 'node:test';
import assert from 'node:assert/strict';
import {scientificWarnings,normalizeFigureCandidates,confirmedFigures,manualFigure,modelConfidence,safeScientificReview} from '../studio/ocr-science.js';

test('ZH-77: science alerts retain Persian/Unicode superscript, minus, decimal and negation deltas',()=>{
 const baseline={text:'کدام مورد نیست؟\n۱) −۲٫۵x²\n۲) ۳\n۳) ۴\n۴) ۵',latex:['x^{2}']};
 const warnings=scientificWarnings({kind:'question',text:'کدام مورد است؟\n۱) ۲۵x³\n۲) ۳\n۳) ۴',latex:['x^{3}'],previous:baseline});
 const ids=warnings.map(x=>x.id);
 for(const needed of ['negation_changed','minus_changed','decimal_changed','exponent_changed','numbers_changed','options_incomplete','options_lost','exponent_present']){
  assert.ok(ids.includes(needed),needed+' not detected: '+ids.join(', '));
 }
 assert.ok(warnings.filter(x=>x.id.endsWith('_changed')).every(x=>x.severity==='critical'));
 assert.ok(ids.includes('options_incomplete'));
});
test('ZH-77: clean answer does not require arbitrary four options',()=>{
 const warnings=scientificWarnings({kind:'answer',text:'پاسخ درست چیست؟'});
 assert.equal(warnings.length,0);
});
test('ZH-77: confidence is model-reported, bounded, uncalibrated and optional',()=>{
 assert.equal(modelConfidence(null),null);
 assert.equal(modelConfidence('0.9'),null);
 assert.equal(modelConfidence(1.1),null);
 assert.equal(modelConfidence(-.1),null);
 assert.equal(modelConfidence(.92344),.923);
 const warnings=scientificWarnings({text:'متن',confidence:.55});
 assert.ok(warnings.some(x=>x.id==='low_model_confidence'));
 const qa=safeScientificReview(warnings,['low_model_confidence','not-found'],.55);
 assert.deepEqual(qa.acknowledged_ids,['low_model_confidence']);
 assert.equal(qa.model_reported_confidence,.55);
 assert.equal(qa.confidence_calibrated,false);
 assert.equal(qa.pending_count,0);
});
test('ZH-77: candidate figures are bounded and only approved items persist',()=>{
 const figures=normalizeFigureCandidates([
  {bbox_norm:[.1,.1,.9,.7],type:'graph',confidence:.81,label:'توزیع'},
  {bbox_norm:[.1,.1,.9,.7],type:'graph',label:'duplicate'},
  {bbox_norm:[0,.1,1.9,.6],type:'image'},
  {bbox_norm:[.91,.2,.911,.201],type:'diagram'}
 ]);
 assert.equal(figures.length,1);
 assert.equal(confirmedFigures(figures).length,0);
 figures[0].status='operator_confirmed';
 const saved=confirmedFigures(figures);
 assert.equal(saved.length,1);
 assert.equal(saved[0].status,'operator_confirmed');
 assert.equal(saved[0].model_confidence,.81);
 assert.equal(manualFigure([.1,.3,.6,.9]).source,'operator');
 assert.throws(()=>manualFigure([.2,.2,.2,.4]),/FIGURE_BOX_INVALID/);
});


test('ZH-77: approved text whitespace normalization preserves source-box character offsets',async()=>{
 const {safeOcrReview}=await import('../studio/ocr-core.js');
 const result=safeOcrReview({
  text:'  ۲ + ۲  ',latex:[],notes:'',source:'manual',passes:0,
  links:[{start:2,end:3,bbox_norm:[.1,.1,.35,.3],source:'operator'}],
  imageRegions:[{page:2,bbox_norm:[.2,.1,.8,.9]}],
  events:[{type:'linked_manually',link_start:2,bbox_norm:[.1,.1,.35,.3],at:'2026-10-13T00:00:00Z'}]
 });
 assert.equal(result.text,'۲ + ۲');
 assert.equal(result.image_map.links[0].start,0);
 assert.equal(result.image_map.links[0].end,1);
 assert.equal(result.image_map.events[0].link_start,0);
});
