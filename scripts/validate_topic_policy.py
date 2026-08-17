#!/usr/bin/env python3
"""Fail closed when generated public content violates the repository topic boundary."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / ".automation" / "content-policy.json"
TEXT_SUFFIXES = {".ts", ".js", ".json", ".md", ".xml", ".toml", ".txt"}
IGNORED_PARTS = {"node_modules", "dist", "graphify-out", ".git"}


def normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


def load_policy(path: Path = POLICY_PATH) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("content policy must be a JSON object")
    allowed = data.get("allowed_categories")
    denied = data.get("denied_phrases")
    if not isinstance(allowed, list) or not all(isinstance(item, str) for item in allowed):
        raise ValueError("allowed_categories must be a string array")
    if not isinstance(denied, list) or not all(isinstance(item, str) for item in denied):
        raise ValueError("denied_phrases must be a string array")
    return data


def text_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return [
        path
        for path in sorted(target.rglob("*"))
        if path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and not any(part in IGNORED_PARTS for part in path.parts)
    ]


def validate_target(target: Path, policy_path: Path = POLICY_PATH) -> list[str]:
    policy = load_policy(policy_path)
    denied = [normalize(item) for item in policy["denied_phrases"]]  # type: ignore[index]
    findings: list[str] = []
    for path in text_files(target):
        try:
            content = normalize(path.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            findings.append(f"non-UTF-8 text: {path}")
            continue
        for phrase in denied:
            pattern = rf"(?<!\w){re.escape(phrase)}(?!\w)"
            if phrase and re.search(pattern, content, flags=re.UNICODE):
                findings.append(f"denied phrase {phrase!r} in {path}")
    return findings


def validate_category(category: object, policy_path: Path = POLICY_PATH) -> list[str]:
    policy = load_policy(policy_path)
    allowed = set(policy["allowed_categories"])  # type: ignore[arg-type]
    if not isinstance(category, str) or category not in allowed:
        return [f"category must be one of {sorted(allowed)}"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", type=Path)
    parser.add_argument("--category")
    parser.add_argument("--policy", type=Path, default=POLICY_PATH)
    args = parser.parse_args()
    errors = validate_target(args.target.resolve(), args.policy.resolve())
    if args.category is not None:
        errors.extend(validate_category(args.category, args.policy.resolve()))
    if errors:
        for error in errors:
            print(f"TOPIC_POLICY_ERROR: {error}", file=sys.stderr)
        return 1
    print("TOPIC_POLICY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
