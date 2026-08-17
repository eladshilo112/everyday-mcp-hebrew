#!/usr/bin/env python3
"""Validate solution metadata and the central catalog without dependencies."""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOLUTIONS = ROOT / "solutions"
CATALOG = ROOT / "CATALOG.md"
FOLDER_RE = re.compile(r"^(?P<id>\d{3})-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$")


def load_metadata(folder: Path, root: Path) -> dict[str, object]:
    metadata_path = folder / "metadata.json"
    if not metadata_path.is_file():
        raise ValueError(f"missing {metadata_path.relative_to(root)}")
    try:
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid {metadata_path.relative_to(root)}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"metadata must be an object: {metadata_path.relative_to(root)}")
    return data


def validate_catalog(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    solutions = root / "solutions"
    catalog_path = root / "CATALOG.md"
    if not catalog_path.is_file():
        return ["missing CATALOG.md"]
    catalog = catalog_path.read_text(encoding="utf-8")
    seen_ids: set[str] = set()
    seen_dates: set[str] = set()

    for folder in sorted(path for path in solutions.iterdir() if path.is_dir()):
        match = FOLDER_RE.fullmatch(folder.name)
        if match is None:
            errors.append(f"invalid solution folder name: {folder.name}")
            continue
        try:
            metadata = load_metadata(folder, root)
        except ValueError as exc:
            errors.append(str(exc))
            continue

        expected_id = match.group("id")
        expected_slug = match.group("slug")
        actual_id = metadata.get("id")
        actual_slug = metadata.get("slug")
        actual_date = metadata.get("date")
        if actual_id != expected_id:
            errors.append(f"{folder.name}: metadata id must be {expected_id}")
        if actual_slug != expected_slug:
            errors.append(f"{folder.name}: metadata slug must be {expected_slug}")
        if not isinstance(actual_date, str):
            errors.append(f"{folder.name}: metadata date must be a string")
        else:
            try:
                date.fromisoformat(actual_date)
            except ValueError:
                errors.append(f"{folder.name}: invalid ISO date {actual_date!r}")

        if expected_id in seen_ids:
            errors.append(f"duplicate solution id: {expected_id}")
        seen_ids.add(expected_id)
        if isinstance(actual_date, str):
            if actual_date in seen_dates:
                errors.append(f"duplicate solution date: {actual_date}")
            seen_dates.add(actual_date)

        catalog_link = f"[${expected_id}-{expected_slug}]".replace("$", "")
        catalog_path_text = f"solutions/{folder.name}/"
        if catalog_link not in catalog or catalog_path_text not in catalog:
            errors.append(f"{folder.name}: missing or incorrect CATALOG.md entry")

    expected_ids = [f"{number:03d}" for number in range(1, len(seen_ids) + 1)]
    if sorted(seen_ids) != expected_ids:
        errors.append(f"solution ids must be contiguous from 001: found {sorted(seen_ids)}")
    return errors


def main() -> int:
    errors = validate_catalog()
    if errors:
        for error in errors:
            print(f"CATALOG_ERROR: {error}", file=sys.stderr)
        return 1
    print("CATALOG_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
