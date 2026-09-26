import {DIFFICULTIES} from "./quality.js";

function emptyDifficulty(){return Object.fromEntries(DIFFICULTIES.map(level=>[level,0]))}

export function buildCatalog(questions,taxonomy){
  const subjects={};
  for(const [code,cfg] of Object.entries(taxonomy?.subjects||{})){
    subjects[code]={
      name_fa:cfg.name_fa||code,
      chapter_name_fa:cfg.chapter_name_fa||"فصل",
      unit_name_fa:cfg.unit_name_fa||"مبحث",
      count:0,
      difficulty_counts:emptyDifficulty(),
      grades:Object.fromEntries(Object.entries(cfg.grades||{}).map(([grade,gradeCfg])=>[
        grade,{name_fa:gradeCfg.name_fa||grade,count:0,difficulty_counts:emptyDifficulty(),chapters:{}}
      ]))
    };
  }
  for(const q of questions||[]){
    if(q?.status!=="verified")continue;
    const subject=subjects[String(q.subject||"").toUpperCase()];
    const grade=subject?.grades?.[String(q.grade)];
    if(!subject||!grade)throw new Error(`Taxonomy missing for ${q.id||"question"}`);
    const chapter=String(q.chapter||"UNSPECIFIED"),unit=String(q.unit||"UNSPECIFIED"),difficulty=String(q.difficulty||"level_3");
    subject.count++;grade.count++;
    if(DIFFICULTIES.includes(difficulty)){subject.difficulty_counts[difficulty]++;grade.difficulty_counts[difficulty]++}
    const chapterNode=grade.chapters[chapter]||={count:0,difficulty_counts:emptyDifficulty(),units:{},unit_difficulty_counts:{}};
    chapterNode.count++;
    if(DIFFICULTIES.includes(difficulty))chapterNode.difficulty_counts[difficulty]++;
    chapterNode.units[unit]=(chapterNode.units[unit]||0)+1;
    const unitDiff=chapterNode.unit_difficulty_counts[unit]||=emptyDifficulty();
    if(DIFFICULTIES.includes(difficulty))unitDiff[difficulty]++;
  }
  return {
    version:3,
    total_verified:Object.values(subjects).reduce((sum,x)=>sum+x.count,0),
    difficulty_counts:Object.fromEntries(DIFFICULTIES.map(level=>[
      level,Object.values(subjects).reduce((sum,x)=>sum+x.difficulty_counts[level],0)
    ])),
    subjects
  };
}
