#!/usr/bin/env python3
"""Validate Codex JSON output and write only its inert unified patch field."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from daily_patch import SLUG_RE, validate_patch_text

REQUIRED_KEYS = {"solution_id", "slug", "summary", "patch"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-id", required=True)
    parser.add_argument("--expected-slug", required=True)
    args = parser.parse_args()
    raw = os.environ.get("CODEX_OUTPUT_JSON", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"CODEX_OUTPUT_ERROR: invalid JSON: {exc}", file=sys.stderr)
        return 1
    errors: list[str] = []
    if not isinstance(data, dict) or set(data) != REQUIRED_KEYS:
        errors.append(f"output keys must exactly equal {sorted(REQUIRED_KEYS)}")
    else:
        if data.get("solution_id") != args.expected_id:
            errors.append("solution_id does not match")
        if data.get("slug") != args.expected_slug or SLUG_RE.fullmatch(str(data.get("slug"))) is None:
            errors.append("slug does not match")
        summary = data.get("summary")
        if not isinstance(summary, str) or not 10 <= len(summary) <= 500:
            errors.append("summary length is invalid")
        patch = data.get("patch")
        if not isinstance(patch, str):
            errors.append("patch must be a string")
        else:
            errors.extend(validate_patch_text(patch, args.expected_id, args.expected_slug, args.root.resolve()))
    if errors:
        for error in errors:
            print(f"CODEX_OUTPUT_ERROR: {error}", file=sys.stderr)
        return 1
    patch_text = str(data["patch"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(patch_text, encoding="utf-8", newline="\n")
    print("CODEX_OUTPUT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
