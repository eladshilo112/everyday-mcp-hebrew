#!/usr/bin/env python3
"""Validate the local run coordination contract and optional run manifest."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / ".automation" / "coordination-policy.json"
MANIFEST_SCHEMA_PATH = ROOT / ".automation" / "run-manifest.schema.json"
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$")
STAGES = {
    "initialized",
    "preflight",
    "planning",
    "implementation",
    "validation",
    "review",
    "publication",
    "completed",
    "failed",
}
STATUSES = {
    "running",
    "preflight_passed",
    "planning",
    "implementation",
    "validation",
    "review",
    "publishing",
    "published",
    "dry_run_passed",
    "duplicate_date_noop",
    "failed",
}


def load_object(path: Path) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def validate_manifest_schema(path: Path = MANIFEST_SCHEMA_PATH) -> list[str]:
    try:
        schema = load_object(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return [f"invalid run manifest schema: {exc}"]
    errors: list[str] = []
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return ["run manifest schema properties must be an object"]
    required = schema.get("required")
    expected_required = {
        "version",
        "run_id",
        "repository",
        "owner_role",
        "status",
        "phase",
        "started_at_utc",
        "heartbeat_at_utc",
        "next_action",
        "blocked_reason",
        "artifacts",
    }
    if set(required or []) != expected_required:
        errors.append("run manifest schema required fields drifted")
    status_enum = properties.get("status", {}).get("enum", []) if isinstance(properties.get("status"), dict) else []
    if set(status_enum) != STATUSES:
        errors.append("run manifest schema status enum drifted")
    phase_enum = properties.get("phase", {}).get("enum", []) if isinstance(properties.get("phase"), dict) else []
    if set(phase_enum) != STAGES:
        errors.append("run manifest schema phase enum drifted")
    return errors


def validate_policy(path: Path = POLICY_PATH) -> list[str]:
    errors = validate_manifest_schema()
    try:
        data = load_object(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return errors + [f"invalid coordination policy: {exc}"]

    if data.get("version") != 1:
        errors.append("coordination policy version must be 1")
    source = data.get("source_of_truth")
    if not isinstance(source, dict) or set(source) != {
        "run_status",
        "run_evidence",
        "human_handoff",
        "repository_status",
    }:
        errors.append("source_of_truth must define four canonical records")
    roles = data.get("roles")
    if not isinstance(roles, list) or not roles:
        errors.append("roles must be a non-empty array")
    else:
        role_ids = [role.get("id") for role in roles if isinstance(role, dict)]
        if len(role_ids) != len(set(role_ids)):
            errors.append("role ids must be unique")
        required_roles = {"owner_chat", "claude_planner", "codex_implementer", "deterministic_gates", "local_runner"}
        if set(role_ids) != required_roles:
            errors.append(f"roles must be exactly {sorted(required_roles)}")
    if data.get("stages") != sorted(STAGES, key=lambda value: [
        "initialized", "preflight", "planning", "implementation", "validation", "review", "publication", "completed", "failed"
    ].index(value)):
        errors.append("stages must use the canonical ordered stage list")
    concurrency = data.get("concurrency")
    if not isinstance(concurrency, dict):
        errors.append("concurrency must be an object")
    else:
        if concurrency.get("max_daily_runs") != 1:
            errors.append("max_daily_runs must be 1")
        if concurrency.get("duplicate_date") != "noop":
            errors.append("duplicate_date must be noop")
    rules = data.get("artifact_rules")
    if not isinstance(rules, dict) or rules.get("run_local_only") is not True or rules.get("one_owner_per_run") is not True:
        errors.append("artifact rules must enforce local-only evidence and one owner")
    handoff = data.get("handoff")
    if not isinstance(handoff, dict) or handoff.get("sync_key") != "run_id":
        errors.append("handoff sync key must be run_id")
    return errors


def validate_manifest(path: Path, policy_path: Path = POLICY_PATH) -> list[str]:
    errors = validate_policy(policy_path)
    try:
        manifest = load_object(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return errors + [f"invalid run manifest: {exc}"]

    required = {
        "version",
        "run_id",
        "repository",
        "owner_role",
        "status",
        "phase",
        "started_at_utc",
        "heartbeat_at_utc",
        "next_action",
        "blocked_reason",
        "artifacts",
    }
    missing = sorted(required - set(manifest))
    if missing:
        errors.append(f"run manifest missing fields: {', '.join(missing)}")
    if manifest.get("version") != 1:
        errors.append("run manifest version must be 1")
    if not isinstance(manifest.get("run_id"), str) or not RUN_ID_RE.fullmatch(str(manifest.get("run_id"))):
        errors.append("run_id must use YYYYMMDD-HHMMSS-xxxxxxxx")
    if manifest.get("owner_role") != "local_runner":
        errors.append("owner_role must be local_runner")
    if manifest.get("status") not in STATUSES:
        errors.append("run manifest status is not canonical")
    if manifest.get("phase") not in STAGES:
        errors.append("run manifest phase is not canonical")
    for key in ("started_at_utc", "heartbeat_at_utc"):
        if not isinstance(manifest.get(key), str) or not str(manifest[key]).endswith("Z"):
            errors.append(f"{key} must be an ISO UTC timestamp ending in Z")
    if not isinstance(manifest.get("next_action"), str) or not str(manifest["next_action"]).strip():
        errors.append("next_action must be a non-empty string")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        errors.append("artifacts must be an array")
    else:
        seen: set[str] = set()
        for index, artifact in enumerate(artifacts):
            if not isinstance(artifact, dict):
                errors.append(f"artifact {index} must be an object")
                continue
            path_value = artifact.get("path")
            if not isinstance(path_value, str) or not path_value or Path(path_value).is_absolute() or ".." in Path(path_value).parts:
                errors.append(f"artifact {index} path must be relative and confined")
            elif path_value in seen:
                errors.append(f"duplicate artifact path: {path_value}")
            else:
                seen.add(path_value)
            if not isinstance(artifact.get("kind"), str) or not isinstance(artifact.get("stage"), str):
                errors.append(f"artifact {index} needs kind and stage")
            sha = artifact.get("sha256")
            if sha is not None and (not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha)):
                errors.append(f"artifact {index} sha256 is invalid")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, default=POLICY_PATH)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    errors = validate_policy(args.policy.resolve())
    if args.manifest:
        errors = validate_manifest(args.manifest.resolve(), args.policy.resolve())
    if errors:
        for error in errors:
            print(f"COORDINATION_ERROR: {error}", file=sys.stderr)
        return 1
    print("COORDINATION_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
