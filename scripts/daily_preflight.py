#!/usr/bin/env python3
"""Compute the next daily solution identity and prevent duplicate dates."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from timezone_guard import jerusalem_time, parse_utc


def discover(root: Path, now_utc: datetime) -> dict[str, str]:
    local_date = jerusalem_time(now_utc).date().isoformat()
    ids: list[int] = []
    dates: set[str] = set()
    for metadata_path in sorted((root / "solutions").glob("*/metadata.json")):
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
        ids.append(int(str(data["id"])))
        dates.add(str(data["date"]))
    next_id = f"{max(ids, default=0) + 1:03d}"
    return {
        "date": local_date,
        "solution_id": next_id,
        "should_run": "false" if local_date in dates else "true",
    }


def write_outputs(path: Path, values: dict[str, str]) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--now-utc", default=os.environ.get("DAILY_NOW_UTC"))
    args = parser.parse_args()
    now_utc = parse_utc(args.now_utc) if args.now_utc else datetime.now(timezone.utc)
    values = discover(args.root.resolve(), now_utc)
    if args.github_output:
        write_outputs(args.github_output, values)
    print(json.dumps(values, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
