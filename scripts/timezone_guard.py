#!/usr/bin/env python3
"""Timezone helpers used to verify the 09:00 Asia/Jerusalem schedule."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

JERUSALEM = ZoneInfo("Asia/Jerusalem")


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def jerusalem_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(JERUSALEM)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--utc", help="ISO 8601 UTC timestamp; defaults to now")
    parser.add_argument("--expect-hour", type=int, choices=range(24))
    args = parser.parse_args()
    current = parse_utc(args.utc) if args.utc else datetime.now(timezone.utc)
    local = jerusalem_time(current)
    print(local.isoformat())
    if args.expect_hour is not None and local.hour != args.expect_hour:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
