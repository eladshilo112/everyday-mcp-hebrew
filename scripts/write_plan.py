#!/usr/bin/env python3
"""Validate Claude structured output and materialize it as inert JSON data."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REQUIRED_KEYS = {
    "solution_id",
    "date",
    "slug",
    "title_he",
    "title_en",
    "problem_he",
    "audience_he",
    "benefit_he",
    "tool_names",
    "implementation_requirements",
    "test_cases",
}
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TOOL_RE = re.compile(r"^[a-z][a-z0-9_]{2,60}$")


def validate_plan(data: object, expected_id: str, expected_date: str) -> list[str]:
    if not isinstance(data, dict):
        return ["plan must be a JSON object"]
    errors: list[str] = []
    if set(data) != REQUIRED_KEYS:
        errors.append(f"plan keys must exactly equal {sorted(REQUIRED_KEYS)}")
    if data.get("solution_id") != expected_id:
        errors.append("plan solution_id does not match preflight")
    if data.get("date") != expected_date:
        errors.append("plan date does not match Jerusalem date")
    slug = data.get("slug")
    if not isinstance(slug, str) or len(slug) > 50 or SLUG_RE.fullmatch(slug) is None:
        errors.append("invalid plan slug")
    tools = data.get("tool_names")
    if not isinstance(tools, list) or not 1 <= len(tools) <= 3 or any(not isinstance(item, str) or TOOL_RE.fullmatch(item) is None for item in tools):
        errors.append("invalid tool_names")
    requirements = data.get("implementation_requirements")
    tests = data.get("test_cases")
    if not isinstance(requirements, list) or not 5 <= len(requirements) <= 20:
        errors.append("implementation_requirements must contain 5 through 20 items")
    if not isinstance(tests, list) or not 8 <= len(tests) <= 20:
        errors.append("test_cases must contain 8 through 20 items")
    for key in ("title_he", "title_en", "problem_he", "audience_he", "benefit_he"):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip() or any(ord(char) < 32 and char not in "\n\t" for char in value):
            errors.append(f"invalid text field: {key}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-id", required=True)
    parser.add_argument("--expected-date", required=True)
    args = parser.parse_args()
    raw = os.environ.get("DAILY_PLAN_JSON", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"PLAN_ERROR: invalid JSON: {exc}", file=sys.stderr)
        return 1
    errors = validate_plan(data, args.expected_id, args.expected_date)
    if errors:
        for error in errors:
            print(f"PLAN_ERROR: {error}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("PLAN_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
