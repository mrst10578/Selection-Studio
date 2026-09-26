from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from common import dump_json, load_jsonl

DIFFICULTIES = ("level_1", "level_2", "level_3", "level_4", "level_5")

def empty_difficulty() -> dict[str, int]:
    return {level: 0 for level in DIFFICULTIES}

def build_catalog(questions: list[dict[str, Any]], taxonomy: dict[str, Any]) -> dict[str, Any]:
    subjects: dict[str, Any] = {}
    for code, cfg in taxonomy.get("subjects", {}).items():
        subjects[code] = {
            "name_fa": cfg.get("name_fa", code),
            "chapter_name_fa": cfg.get("chapter_name_fa", "فصل"),
            "unit_name_fa": cfg.get("unit_name_fa", "مبحث"),
            "count": 0,
            "difficulty_counts": empty_difficulty(),
            "grades": {
                grade: {
                    "name_fa": grade_cfg.get("name_fa", grade),
                    "count": 0,
                    "difficulty_counts": empty_difficulty(),
                    "chapters": {},
                }
                for grade, grade_cfg in cfg.get("grades", {}).items()
            },
        }

    for q in questions:
        if q.get("status") != "verified":
            continue
        subject = subjects[str(q["subject"]).upper()]
        grade = subject["grades"][str(q["grade"])]
        chapter = str(q.get("chapter") or "UNSPECIFIED")
        unit = str(q.get("unit") or "UNSPECIFIED")
        difficulty = str(q.get("difficulty") or "level_3")

        subject["count"] += 1
        grade["count"] += 1
        if difficulty in DIFFICULTIES:
            subject["difficulty_counts"][difficulty] += 1
            grade["difficulty_counts"][difficulty] += 1

        chapter_node = grade["chapters"].setdefault(chapter, {
            "count": 0,
            "difficulty_counts": empty_difficulty(),
            "units": {},
            "unit_difficulty_counts": {},
        })
        chapter_node["count"] += 1
        if difficulty in DIFFICULTIES:
            chapter_node["difficulty_counts"][difficulty] += 1

        chapter_node["units"][unit] = chapter_node["units"].get(unit, 0) + 1
        unit_diff = chapter_node["unit_difficulty_counts"].setdefault(unit, empty_difficulty())
        if difficulty in DIFFICULTIES:
            unit_diff[difficulty] += 1

    return {
        "version": 3,
        "total_verified": sum(x["count"] for x in subjects.values()),
        "difficulty_counts": {
            level: sum(x["difficulty_counts"][level] for x in subjects.values())
            for level in DIFFICULTIES
        },
        "subjects": subjects,
    }

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions", default="data/questions.jsonl")
    parser.add_argument("--taxonomy", default="taxonomy/taxonomy.json")
    parser.add_argument("--output", default="runtime/catalog.json")
    args = parser.parse_args()
    catalog = build_catalog(
        load_jsonl(args.questions),
        json.loads(Path(args.taxonomy).read_text(encoding="utf-8")),
    )
    dump_json(args.output, catalog)
    print(f"catalog built: {catalog['total_verified']} verified questions")

if __name__ == "__main__":
    main()
