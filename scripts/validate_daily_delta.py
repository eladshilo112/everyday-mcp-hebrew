#!/usr/bin/env python3
"""Validate the applied daily worktree delta before any generated code runs."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from validate_catalog import validate_catalog
from validate_solution import validate_static

ROOT = Path(__file__).resolve().parents[1]


def status_paths(root: Path) -> list[str]:
    completed = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    paths: list[str] = []
    for line in completed.stdout.splitlines():
        if not line:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.append(path.replace("\\", "/"))
    return paths


def validate_delta(root: Path, expected_id: str, expected_slug: str) -> list[str]:
    errors: list[str] = []
    prefix = f"solutions/{expected_id}-{expected_slug}/"
    paths = status_paths(root)
    if "CATALOG.md" not in paths:
        errors.append("CATALOG.md is not changed")
    solution_paths = [path for path in paths if path.startswith(prefix)]
    if not solution_paths:
        errors.append("no new solution files are present")
    for path in paths:
        if path != "CATALOG.md" and not path.startswith(prefix):
            errors.append(f"out-of-scope worktree change: {path}")
        absolute = root / path
        if absolute.is_symlink():
            errors.append(f"symlink is forbidden: {path}")
    if len(paths) > 50:
        errors.append("more than 50 files changed")
    solution = root / prefix.rstrip("/")
    if solution.exists():
        errors.extend(validate_static(solution))
    errors.extend(validate_catalog(root))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--expected-id", required=True)
    parser.add_argument("--expected-slug", required=True)
    args = parser.parse_args()
    try:
        errors = validate_delta(args.root.resolve(), args.expected_id, args.expected_slug)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"DELTA_ERROR: {exc}", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(f"DELTA_ERROR: {error}", file=sys.stderr)
        return 1
    print("DELTA_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
