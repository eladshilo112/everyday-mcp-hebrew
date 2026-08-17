#!/usr/bin/env python3
"""Apply an already-tested patch in the write-capable publishing job."""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import subprocess
import sys
from pathlib import Path

from daily_patch import validate_patch_text
from validate_daily_delta import validate_delta

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--expected-id", required=True)
    parser.add_argument("--expected-slug", required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    encoded = os.environ.get("VALIDATED_PATCH_B64", "")
    expected_digest = os.environ.get("VALIDATED_PATCH_SHA256", "")
    try:
        patch_bytes = base64.b64decode(encoded, validate=True)
        patch_text = patch_bytes.decode("utf-8")
    except (ValueError, UnicodeDecodeError) as exc:
        print(f"PATCH_APPLY_ERROR: invalid patch encoding: {exc}", file=sys.stderr)
        return 1
    actual_digest = hashlib.sha256(patch_bytes).hexdigest()
    if actual_digest != expected_digest:
        print("PATCH_APPLY_ERROR: sha256 mismatch", file=sys.stderr)
        return 1
    errors = validate_patch_text(patch_text, args.expected_id, args.expected_slug, root)
    if errors:
        for error in errors:
            print(f"PATCH_APPLY_ERROR: {error}", file=sys.stderr)
        return 1
    try:
        subprocess.run(["git", "apply", "--check", "-"], cwd=root, input=patch_bytes, check=True)
        subprocess.run(["git", "apply", "-"], cwd=root, input=patch_bytes, check=True)
        errors = validate_delta(root, args.expected_id, args.expected_slug)
    except subprocess.CalledProcessError as exc:
        print(f"PATCH_APPLY_ERROR: {exc}", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(f"PATCH_APPLY_ERROR: {error}", file=sys.stderr)
        return 1
    print(f"PATCH_APPLY_OK: sha256={actual_digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
