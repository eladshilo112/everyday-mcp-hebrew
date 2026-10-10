#!/usr/bin/env python3
"""Add one validated daily solution row to CATALOG.md when the model omitted it."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FOLDER_RE = re.compile(r"^(?P<id>\d{3})-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$")
EXPECTED_SAFETY = {
    "read_only": True,
    "destructive": False,
    "network": False,
    "telemetry": False,
}
SAFETY_TEXT = "מקומי, קריאה בלבד, ללא רשת וללא שינוי קבצים"


def _single_line(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"metadata.{field} must be a non-empty string")
    text = " ".join(value.split())
    if "|" in text:
        raise ValueError(f"metadata.{field} may not contain a table separator")
    return text


def ensure_catalog_entry(root: Path, solution_relative: str) -> str:
    root = root.resolve()
    solution = (root / solution_relative).resolve()
    solutions_root = (root / "solutions").resolve()
    try:
        solution.relative_to(solutions_root)
    except ValueError as exc:
        raise ValueError("solution must be inside solutions/") from exc
    if solution.parent != solutions_root:
        raise ValueError("solution must be a direct child of solutions/")
    match = FOLDER_RE.fullmatch(solution.name)
    if match is None:
        raise ValueError("solution folder must use NNN-lowercase-slug")

    metadata_path = solution / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"could not read metadata.json: {exc}") from exc
    if not isinstance(metadata, dict):
        raise ValueError("metadata.json must contain an object")

    expected_id = match.group("id")
    expected_slug = match.group("slug")
    if metadata.get("id") != expected_id or metadata.get("slug") != expected_slug:
        raise ValueError("metadata identity does not match the solution folder")
    date = _single_line(metadata.get("date"), "date")
    title = _single_line(metadata.get("title_he"), "title_he")
    audience_value = metadata.get("audience_he") or metadata.get("description_he")
    audience = _single_line(audience_value, "audience_he")
    if metadata.get("safety") != EXPECTED_SAFETY:
        raise ValueError("metadata.safety must describe a local read-only non-network solution")

    catalog_path = root / "CATALOG.md"
    try:
        catalog = catalog_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"could not read CATALOG.md: {exc}") from exc
    catalog_path_text = f"solutions/{solution.name}/"
    catalog_link = f"[{solution.name}]"
    if catalog_link in catalog or catalog_path_text in catalog:
        return "CATALOG_ALREADY_PRESENT"

    marker = "</div>"
    marker_index = catalog.rfind(marker)
    if marker_index < 0:
        raise ValueError("CATALOG.md is missing its closing RTL marker")
    row = f"| {expected_id} | {date} | {title} | {audience} | {SAFETY_TEXT} | [{solution.name}]({catalog_path_text}) |"
    prefix = catalog[:marker_index].rstrip()
    suffix = catalog[marker_index:]
    catalog_path.write_text(f"{prefix}\n{row}\n\n{suffix}", encoding="utf-8")
    return "CATALOG_REPAIRED"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--solution", required=True)
    args = parser.parse_args()
    try:
        print(ensure_catalog_entry(args.root, args.solution))
    except (OSError, ValueError) as exc:
        print(f"CATALOG_REPAIR_ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
