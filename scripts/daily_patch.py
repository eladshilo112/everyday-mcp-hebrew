#!/usr/bin/env python3
"""Shared fail-closed validation for model-produced daily patches."""

from __future__ import annotations

import re
from pathlib import Path

MAX_PATCH_BYTES = 500_000
MAX_CHANGED_FILES = 50
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DIFF_HEADER_RE = re.compile(r"^diff --git a/([^\s]+) b/([^\s]+)$", re.MULTILINE)


def validate_patch_text(
    patch: str,
    expected_id: str,
    expected_slug: str,
    root: Path,
    *,
    require_absent_solution: bool = True,
) -> list[str]:
    errors: list[str] = []
    encoded = patch.encode("utf-8")
    if len(encoded) > MAX_PATCH_BYTES:
        errors.append(f"patch exceeds {MAX_PATCH_BYTES} bytes")
    if not re.fullmatch(r"\d{3}", expected_id):
        errors.append("expected id must be three digits")
    if SLUG_RE.fullmatch(expected_slug) is None:
        errors.append("slug is not safe")
    if "\x00" in patch:
        errors.append("patch contains NUL")
    forbidden_markers = (
        "GIT binary patch",
        "deleted file mode",
        "rename from ",
        "rename to ",
        "new file mode 120000",
        "new file mode 160000",
        "Subproject commit ",
    )
    for marker in forbidden_markers:
        if marker in patch:
            errors.append(f"forbidden patch marker: {marker}")

    matches = list(DIFF_HEADER_RE.finditer(patch))
    if not matches:
        errors.append("patch has no parseable diff headers")
        return errors
    if len(matches) > MAX_CHANGED_FILES:
        errors.append(f"patch changes more than {MAX_CHANGED_FILES} files")

    solution_prefix = f"solutions/{expected_id}-{expected_slug}/"
    solution_paths = 0
    catalog_paths = 0
    for index, match in enumerate(matches):
        left, right = match.group(1), match.group(2)
        if left != right:
            errors.append(f"renames are forbidden: {left} -> {right}")
            continue
        if ".." in Path(left).parts or left.startswith("/") or "\\" in left:
            errors.append(f"unsafe path: {left}")
            continue
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(patch)
        block = patch[match.start():block_end]
        if left == "CATALOG.md":
            catalog_paths += 1
        elif left.startswith(solution_prefix):
            solution_paths += 1
            if "new file mode 100644" not in block or "--- /dev/null" not in block:
                errors.append(f"daily solution files must be new regular files: {left}")
        else:
            errors.append(f"daily patch may not change: {left}")

    if solution_paths == 0:
        errors.append("patch does not add a solution file")
    if catalog_paths != 1:
        errors.append("patch must update CATALOG.md exactly once")
    if require_absent_solution and (root / solution_prefix.rstrip("/")).exists():
        errors.append(f"solution folder already exists: {solution_prefix}")
    return errors
