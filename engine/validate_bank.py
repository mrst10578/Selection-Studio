from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from common import load_jsonl

ALLOWED_STATUSES = {"draft", "submitted", "verified", "rejected"}
ALLOWED_DIFFICULTIES = {"level_1", "level_2", "level_3", "level_4", "level_5"}

def valid_bbox(value: Any) -> bool:
    if not isinstance(value, list) or len(value) != 4:
        return False
    if not all(isinstance(v, (int, float)) for v in value):
        return False
    x1, y1, x2, y2 = value
    return 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1

def valid_region(region: Any) -> bool:
    return (
        isinstance(region, dict)
        and isinstance(region.get("page"), int)
        and region["page"] >= 1
        and valid_bbox(region.get("bbox_norm"))
    )

def valid_biology_combination(question: dict[str, Any]) -> bool:
    if question.get("subject") != "BIO":
        return True
    combo = question.get("biology_combination")
    if not isinstance(combo, dict) or not isinstance(combo.get("is_combined"), bool):
        return False
    topics = combo.get("topics")
    if not isinstance(topics, list):
        return False
    if not combo["is_combined"]:
        return len(topics) == 0
    if not topics:
        return False

    primary = (
        int(question.get("grade") or 0),
        str(question.get("chapter") or ""),
        str(question.get("unit") or ""),
    )
    seen: set[tuple[int, str, str]] = set()
    for topic in topics:
        if not isinstance(topic, dict):
            return False
        grade = topic.get("grade")
        chapter = str(topic.get("chapter") or "")
        unit = str(topic.get("unit") or "")
        if grade not in {10, 11, 12}:
            return False
        if chapter not in {f"{i:02d}" for i in range(1, 13)}:
            return False
        if unit not in {f"{i:02d}" for i in range(1, 9)}:
            return False
        key = (grade, chapter, unit)
        if key == primary or key in seen:
            return False
        seen.add(key)
    return True

def validate_question(q: dict[str, Any], *, exam_ids: set[str], taxonomy: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    qid = str(q.get("id") or "<missing-id>")
    for key in ["id", "exam_id", "source_question_number", "subject", "grade", "question_regions", "status"]:
        if key not in q:
            errors.append(f"{qid}: missing {key}")

    if q.get("status") not in ALLOWED_STATUSES:
        errors.append(f"{qid}: invalid status")
    if q.get("exam_id") not in exam_ids:
        errors.append(f"{qid}: exam_id not found")

    subject = str(q.get("subject") or "").upper()
    subject_cfg = taxonomy.get("subjects", {}).get(subject)
    if not subject_cfg:
        errors.append(f"{qid}: unknown subject")
    elif str(q.get("grade")) not in subject_cfg.get("grades", {}):
        errors.append(f"{qid}: invalid grade for subject")

    if q.get("difficulty") is not None and q.get("difficulty") not in ALLOWED_DIFFICULTIES:
        errors.append(f"{qid}: difficulty must be level_1..level_5")
    if q.get("correct_option") is not None and q.get("correct_option") not in {1, 2, 3, 4}:
        errors.append(f"{qid}: correct_option must be 1..4")

    regions = q.get("question_regions")
    if not isinstance(regions, list) or not regions or not all(valid_region(x) for x in regions):
        errors.append(f"{qid}: invalid question_regions")
    answers = q.get("answer_regions", [])
    if not isinstance(answers, list) or not all(valid_region(x) for x in answers):
        errors.append(f"{qid}: invalid answer_regions")

    if subject == "BIO" and not valid_biology_combination(q):
        errors.append(f"{qid}: invalid or incomplete biology_combination")

    if q.get("status") == "verified":
        if not str(q.get("chapter") or "").strip():
            errors.append(f"{qid}: verified question requires chapter")
        if not str(q.get("unit") or "").strip():
            errors.append(f"{qid}: verified question requires unit")
        if q.get("difficulty") not in ALLOWED_DIFFICULTIES:
            errors.append(f"{qid}: verified question requires difficulty")
        if q.get("correct_option") not in {1, 2, 3, 4}:
            errors.append(f"{qid}: verified question requires correct_option")
        if not answers:
            errors.append(f"{qid}: verified question requires answer_regions")
    return errors

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions", default="data/questions.jsonl")
    parser.add_argument("--exams", default="data/exams.jsonl")
    parser.add_argument("--taxonomy", default="taxonomy/taxonomy.json")
    args = parser.parse_args()

    questions = load_jsonl(args.questions)
    exams = load_jsonl(args.exams)
    taxonomy = json.loads(Path(args.taxonomy).read_text(encoding="utf-8"))

    errors: list[str] = []
    exam_ids: set[str] = set()
    for exam in exams:
        exam_id = str(exam.get("id") or "")
        if not exam_id:
            errors.append("exam record missing id")
        elif exam_id in exam_ids:
            errors.append(f"duplicate exam id: {exam_id}")
        else:
            exam_ids.add(exam_id)

    question_ids: set[str] = set()
    for q in questions:
        qid = str(q.get("id") or "")
        if qid in question_ids:
            errors.append(f"duplicate question id: {qid}")
        question_ids.add(qid)
        errors.extend(validate_question(q, exam_ids=exam_ids, taxonomy=taxonomy))

    if errors:
        print("\n".join(f"ERROR: {e}" for e in errors), file=sys.stderr)
        raise SystemExit(1)
    print(f"bank valid: exams={len(exams)} questions={len(questions)}")

if __name__ == "__main__":
    main()
