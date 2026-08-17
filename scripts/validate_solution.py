#!/usr/bin/env python3
"""Validate one self-contained TypeScript MCP solution using fixed commands."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from scan_secrets import scan
from validate_topic_policy import validate_category, validate_target as validate_topic_policy

ROOT = Path(__file__).resolve().parents[1]
SOLUTIONS_ROOT = ROOT / "solutions"
FOLDER_RE = re.compile(r"^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)$")
REQUIRED_FILES = {
    "README.md",
    "metadata.json",
    "package.json",
    "tsconfig.json",
    "src/server.ts",
    "src/schemas.ts",
    "tests/mcp-integration.test.ts",
    "evaluations.xml",
}
ALLOWED_DEPENDENCIES = {
    "@modelcontextprotocol/server": "2.0.0",
    "zod": "4.4.3",
}
ALLOWED_DEV_DEPENDENCIES = {
    "@modelcontextprotocol/client": "2.0.0",
    "@types/node": "20.19.43",
    "typescript": "7.0.2",
}
ALLOWED_SCRIPT_KEYS = {"build", "check", "test", "start", "demo"}
FORBIDDEN_SCRIPT_FRAGMENTS = (
    "curl ",
    "wget ",
    "powershell",
    "pwsh",
    "bash -c",
    "sh -c",
    "eval ",
    "sudo ",
    "rm -rf",
    "http://",
    "https://",
)
FORBIDDEN_CONTENT = (
    "arbel-group",
    "efi capital",
    "efi-capital",
    "megido",
    "מגידו",
    "אפי קפיטל",
    "אילון פתרונות מימון",
)


def load_json(path: Path) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return data


def ensure_solution_path(path: Path) -> tuple[str, str]:
    resolved = path.resolve()
    resolved.relative_to(SOLUTIONS_ROOT.resolve())
    if resolved.parent != SOLUTIONS_ROOT.resolve():
        raise ValueError("solution must be one direct child of solutions/")
    match = FOLDER_RE.fullmatch(resolved.name)
    if match is None:
        raise ValueError("solution folder must use NNN-lowercase-slug")
    return match.group(1), match.group(2)


def validate_static(solution: Path) -> list[str]:
    errors: list[str] = []
    try:
        solution_id, slug = ensure_solution_path(solution)
    except ValueError as exc:
        return [str(exc)]

    for relative in sorted(REQUIRED_FILES):
        if not (solution / relative).is_file():
            errors.append(f"missing required file: {relative}")

    if errors:
        return errors

    try:
        metadata = load_json(solution / "metadata.json")
        package = load_json(solution / "package.json")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return [f"invalid JSON: {exc}"]

    if metadata.get("id") != solution_id:
        errors.append(f"metadata.id must be {solution_id}")
    if metadata.get("slug") != slug:
        errors.append(f"metadata.slug must be {slug}")
    safety = metadata.get("safety")
    expected_safety = {"read_only": True, "destructive": False, "network": False, "telemetry": False}
    if safety != expected_safety:
        errors.append(f"metadata.safety must equal {expected_safety}")
    if metadata.get("transport") != "stdio":
        errors.append("metadata.transport must be stdio")
    errors.extend(f"metadata.category: {error}" for error in validate_category(metadata.get("category")))

    dependencies = package.get("dependencies")
    dev_dependencies = package.get("devDependencies")
    if dependencies != ALLOWED_DEPENDENCIES:
        errors.append(f"dependencies must exactly equal {ALLOWED_DEPENDENCIES}")
    if dev_dependencies != ALLOWED_DEV_DEPENDENCIES:
        errors.append(f"devDependencies must exactly equal {ALLOWED_DEV_DEPENDENCIES}")
    if package.get("type") != "module":
        errors.append("package type must be module")
    engines = package.get("engines")
    if not isinstance(engines, dict) or engines.get("node") != ">=20":
        errors.append("package engines.node must be >=20")

    scripts = package.get("scripts")
    if not isinstance(scripts, dict):
        errors.append("package scripts must be an object")
    else:
        unknown_scripts = set(scripts) - ALLOWED_SCRIPT_KEYS
        if unknown_scripts:
            errors.append(f"unsupported npm scripts: {sorted(unknown_scripts)}")
        for key, value in scripts.items():
            if not isinstance(value, str):
                errors.append(f"npm script {key} must be a string")
                continue
            lowered = value.lower()
            for fragment in FORBIDDEN_SCRIPT_FRAGMENTS:
                if fragment in lowered:
                    errors.append(f"npm script {key} contains forbidden fragment: {fragment}")
        for required_script in ("build", "check", "test"):
            if required_script not in scripts:
                errors.append(f"missing npm script: {required_script}")

    readme = (solution / "README.md").read_text(encoding="utf-8")
    if not readme.lstrip().startswith('<div dir="rtl">'):
        errors.append("README.md must be Hebrew-first and start with an RTL div")
    skill_path = solution / "skill" / "SKILL.md"
    if skill_path.exists():
        skill_text = skill_path.read_text(encoding="utf-8")
        if not skill_text.startswith("---\n") or "\nname:" not in skill_text or "\ndescription:" not in skill_text:
            errors.append("skill/SKILL.md must contain YAML frontmatter with name and description")
    test_files = sorted((solution / "tests").glob("*.test.ts"))
    if len(test_files) < 4:
        errors.append("solution must contain at least four TypeScript test files")
    try:
        evaluation_root = ET.parse(solution / "evaluations.xml").getroot()
        if evaluation_root.tag != "evaluation":
            errors.append("evaluations.xml root element must be evaluation")
        evaluations = evaluation_root.findall("qa_pair")
        if len(evaluations) != 10:
            errors.append("evaluations.xml must contain exactly ten evaluations")
        for index, evaluation in enumerate(evaluations, start=1):
            question = evaluation.findtext("question", default="").strip()
            if len(question) < 10:
                errors.append(f"evaluation {index} must contain a useful question")
    except ET.ParseError as exc:
        errors.append(f"evaluations.xml is not valid XML: {exc}")
    server_text = (solution / "src/server.ts").read_text(encoding="utf-8")
    required_server_tokens = (
        "serveStdio",
        "structuredContent",
        "readOnlyHint: true",
        "destructiveHint: false",
        "openWorldHint: false",
    )
    for token in required_server_tokens:
        if token not in server_text:
            errors.append(f"src/server.ts missing required token: {token}")
    if "console.log" in server_text:
        errors.append("stdio server must not use console.log")

    for path in sorted(solution.rglob("*")):
        relative = path.relative_to(solution)
        if any(part in {"node_modules", "dist"} for part in relative.parts):
            continue
        if path.is_symlink():
            errors.append(f"symlinks are forbidden: {relative}")
        if path.is_file() and path.suffix.lower() in {".ts", ".js", ".json", ".md", ".xml", ".toml"}:
            text = path.read_text(encoding="utf-8").lower()
            for phrase in FORBIDDEN_CONTENT:
                if phrase in text:
                    errors.append(f"private/business-specific phrase in {relative}: {phrase}")

    for finding in scan(solution):
        errors.append(f"secret pattern: {finding}")
    for finding in validate_topic_policy(solution):
        errors.append(f"topic policy: {finding}")
    return errors


def run(command: list[str], cwd: Path) -> None:
    print(f"RUN_FIXED: {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def validate_runtime(solution: Path, audit: bool) -> None:
    lockfile = solution / "package-lock.json"
    if not lockfile.exists():
        run(["npm", "install", "--package-lock-only", "--ignore-scripts"], solution)
    run(["npm", "ci", "--ignore-scripts"], solution)
    tsc = solution / "node_modules" / ".bin" / ("tsc.cmd" if sys.platform == "win32" else "tsc")
    run([str(tsc), "-p", "tsconfig.json", "--noEmit"], solution)
    run([str(tsc), "-p", "tsconfig.json"], solution)
    tests = sorted((solution / "dist" / "tests").glob("*.test.js"))
    if not tests:
        raise RuntimeError("no compiled tests found")
    run(["node", "--test", *[str(path) for path in tests]], solution)
    if audit:
        run(["npm", "audit", "--audit-level=high"], solution)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("solution", type=Path)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    solution = args.solution.resolve()
    errors = validate_static(solution)
    if errors:
        for error in errors:
            print(f"SOLUTION_ERROR: {error}", file=sys.stderr)
        return 1
    if args.install:
        try:
            validate_runtime(solution, args.audit)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
            print(f"SOLUTION_RUNTIME_ERROR: {exc}", file=sys.stderr)
            return 1
    print(f"SOLUTION_OK: {solution.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
