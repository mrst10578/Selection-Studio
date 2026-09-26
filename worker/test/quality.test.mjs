import test from "node:test";
import assert from "node:assert/strict";
import {batchIssues,questionIssues,normalizePublishedQuestion} from "../src/quality.js";
import {buildCatalog} from "../src/catalog.js";

const region={page:1,bbox_norm:[0.1,0.1,0.8,0.8]};
function question(overrides={}){
  return {
    id:"EXAM-Q001",exam_id:"EXAM",source_question_number:1,subject:"BIO",grade:10,
    chapter:"01",unit:"01",difficulty:"level_3",correct_option:2,
    question_regions:[region],answer_regions:[region],
    biology_combination:{is_combined:false,topics:[]},
    status:"submitted",review_status:"approved",...overrides
  };
}
test("quality gate accepts complete BIO question",()=>{
  assert.deepEqual(questionIssues(question()),[]);
});
test("quality gate rejects incomplete combined BIO metadata",()=>{
  assert.ok(questionIssues(question({biology_combination:{is_combined:true,topics:[]}})).length>0);
});
test("batch gate catches duplicate ids",()=>{
  const q=question();
  const issues=batchIssues({id:"B1",exam:{id:"EXAM"},questions:[q,{...q}]});
  assert.ok(issues.some(x=>x.includes("تکراری")));
});
test("published question is normalized to verified",()=>{
  const out=normalizePublishedQuestion(question(),"reviewer","2026-09-26T00:00:00.000Z");
  assert.equal(out.status,"verified");assert.equal(out.published_by,"reviewer");
});
test("catalog mirrors verified difficulty totals",()=>{
  const taxonomy={subjects:{BIO:{name_fa:"زیست‌شناسی",chapter_name_fa:"فصل",unit_name_fa:"گفتار",grades:{"10":{name_fa:"دهم"}}}}};
  const q=normalizePublishedQuestion(question(),"reviewer");
  const catalog=buildCatalog([q],taxonomy);
  assert.equal(catalog.total_verified,1);
  assert.equal(catalog.difficulty_counts.level_3,1);
  assert.equal(catalog.subjects.BIO.grades["10"].chapters["01"].units["01"],1);
});
