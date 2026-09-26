from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = [
    ".github/workflows/validate.yml",
    ".zzzops/PROJECT.md",
    "AGENTS.md",
    "README.md",
    "package.json",
    "playwright.config.mjs",
    "lighthouserc.json",
    "data",
    "docs",
    "engine",
    "qa",
    "review-console",
    "runtime",
    "schemas",
    "studio",
    "taxonomy",
    "worker",
]
EXCLUDE_PARTS = {"node_modules", "dist", ".git", "__pycache__"}

def selected_files() -> list[Path]:
    files: set[Path] = set()
    for entry in INCLUDE:
        path = ROOT / entry
        if path.is_file():
            files.add(path)
        elif path.is_dir():
            for candidate in path.rglob("*"):
                if candidate.is_file() and not (set(candidate.relative_to(ROOT).parts) & EXCLUDE_PARTS):
                    files.add(candidate)
    return sorted(files, key=lambda p: p.as_posix())

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="dist/selection-studio-recovery.zip")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    files = selected_files()
    manifest = {
        "format": "selection-studio-recovery-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "file_count": len(files),
        "files": [
            {
                "path": path.relative_to(ROOT).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
            for path in files
        ],
    }
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())
        archive.writestr("RECOVERY_MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"recovery archive: {output} ({len(files)} files)")

if __name__ == "__main__":
    main()
