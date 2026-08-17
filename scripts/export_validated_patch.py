#!/usr/bin/env python3
"""Export the tested worktree delta as a bounded base64 GitHub job output."""

from __future__ import annotations

import argparse
import base64
import hashlib
import subprocess
import sys
from pathlib import Path

from daily_patch import MAX_PATCH_BYTES, validate_patch_text

ROOT = Path(__file__).resolve().parents[1]


def append_output(path: Path, key: str, value: str) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{key}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--expected-id", required=True)
    parser.add_argument("--expected-slug", required=True)
    parser.add_argument("--github-output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    solution_dir = f"solutions/{args.expected_id}-{args.expected_slug}"
    try:
        subprocess.run(["git", "add", "-N", "--", solution_dir], cwd=root, check=True)
        completed = subprocess.run(
            ["git", "diff", "--binary", "--", "CATALOG.md", solution_dir],
            cwd=root,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"PATCH_EXPORT_ERROR: {exc}", file=sys.stderr)
        return 1
    patch_bytes = completed.stdout
    if len(patch_bytes) > MAX_PATCH_BYTES:
        print("PATCH_EXPORT_ERROR: patch is too large", file=sys.stderr)
        return 1
    try:
        patch_text = patch_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        print(f"PATCH_EXPORT_ERROR: patch is not UTF-8: {exc}", file=sys.stderr)
        return 1
    errors = validate_patch_text(
        patch_text,
        args.expected_id,
        args.expected_slug,
        root,
        require_absent_solution=False,
    )
    if errors:
        for error in errors:
            print(f"PATCH_EXPORT_ERROR: {error}", file=sys.stderr)
        return 1
    digest = hashlib.sha256(patch_bytes).hexdigest()
    encoded = base64.b64encode(patch_bytes).decode("ascii")
    append_output(args.github_output, "patch_b64", encoded)
    append_output(args.github_output, "patch_sha256", digest)
    print(f"PATCH_EXPORT_OK: {len(patch_bytes)} bytes sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
