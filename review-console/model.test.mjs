import test from "node:test";
import assert from "node:assert/strict";
import {ReviewModel,questionIssues} from "./model.js";
import {filterTaxonomyEntries} from "../studio/taxonomy-data.js";

const valid={id:"EXAM-Q001",exam_id:"EXAM",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[{page:1,bbox_norm:[0,0,1,1]}],answer_regions:[{page:1,bbox_norm:[0,0,1,1]}]};
function modelWith(questions){const model=new ReviewModel();model.load({id:"batch",questions:questions.map(q=>({...valid,...q}))});return model}

test("nextVisibleIndex stays inside the active review filter",()=>{
  const model=modelWith([{source_question_number:1,review_status:"pending"},{source_question_number:2,review_status:"approved"},{source_question_number:3,review_status:"pending"}]);
  assert.equal(model.nextVisibleIndex(0,1,{status:"pending"}),2);
  assert.equal(model.nextVisibleIndex(2,-1,{status:"pending"}),0);
  assert.equal(model.nextVisibleIndex(2,1,{status:"pending"}),-1);
});

test("nextVisibleIndex skips trashed and nonmatching records",()=>{
  const model=modelWith([{source_question_number:1,review_status:"pending",trashed_at:"now"},{source_question_number:2,review_status:"approved"},{source_question_number:3,review_status:"needs_changes"}]);
  assert.equal(model.nextVisibleIndex(-1,1,{status:"needs_changes"}),2);
});

test("question history captures before and after values and undo restores them",()=>{
  const model=modelWith([{difficulty:"level_2"}]);
  model.patch(0,{difficulty:"level_4"},"reviewer");
  const change=model.batch.questions[0].revision_history.at(-1);
  assert.deepEqual(change.changes.difficulty,{before:"level_2",after:"level_4"});
  assert.equal(model.undo(),true);
  assert.equal(model.batch.questions[0].difficulty,"level_2");
});

test("taxonomy search finds matching unit names and keeps the current selection visible",()=>{
  const entries=[["01",{name_fa:"فصل اول",units:{"01":{name_fa:"گفتار نمونه"}}}],["02",{name_fa:"فصل دوم",units:{"01":{name_fa:"گفتار دیگر"}}}]];
  assert.deepEqual(filterTaxonomyEntries(entries,"نمونه").map(([id])=>id),["01"]);
  assert.deepEqual(filterTaxonomyEntries(entries,"ناموجود","02").map(([id])=>id),["02"]);
});

test("final review decisions clear stale correction reason and note",()=>{
  const model=modelWith([{review_status:"needs_changes",review_reason:"taxonomy",review_note:"اصلاح فصل"}]);
  model.setStatus(0,"approved","reviewer");
  assert.equal(model.batch.questions[0].review_status,"approved");
  assert.equal(model.batch.questions[0].review_reason,null);
  assert.equal(model.batch.questions[0].review_note,null);
});

test("review gate rejects invalid canonical taxonomy and identity metadata",()=>{
  assert.ok(questionIssues({...valid,chapter:"99"}).includes("فصل"));
  assert.ok(questionIssues({...valid,unit:"99"}).includes("مبحث"));
  assert.ok(questionIssues({...valid,grade:99}).includes("پایه"));
  assert.ok(questionIssues({...valid,exam_id:""}).includes("آزمون"));
  assert.ok(questionIssues({...valid,source_question_number:0}).includes("شماره"));
});

