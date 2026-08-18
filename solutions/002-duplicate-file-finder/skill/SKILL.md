---
name: file-cleanup-report
description: Scan a local folder for byte-identical files and produce a manual, read-only cleanup report without deleting or changing files.
---

# File cleanup report

Use this skill only for a user-selected local directory.

## Request pattern

Phrase the request like this:

> Scan the local folder at `<PATH>` with `scan_directory`. Use the returned `scan_id` with `find_duplicates`, list every duplicate group in stable path order, then call `suggest_cleanup` and present a manual review plan. Never call or propose an automatic delete, move, rename, overwrite, or file modification operation.

## Required sequence

1. Confirm the exact directory path and any requested limits.
2. Call `scan_directory` once.
3. If `ok` is false, report the structured error and stop.
4. Call `find_duplicates` with the returned `scan_id`.
5. Call `suggest_cleanup` with the same `scan_id`.
6. Show the path to keep, the copies to review manually, and the potential byte savings.
7. Remind the user that no file was changed and that a human must verify every copy before taking action outside this server.

## Safety boundary

The three MCP tools are read-only. Do not invoke any filesystem writing tool as part of this skill. Do not follow symlinks. Do not upload file content or paths. Do not infer that a cleanup action was completed.
