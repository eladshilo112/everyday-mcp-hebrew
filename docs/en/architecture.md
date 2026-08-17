# Repository architecture

Each solution is an independent package. Its MCP server runs locally over stdio, reserves stdout for protocol traffic, and returns both readable text and schema-validated `structuredContent`.

## Trust chain

Claude plans only. Codex returns a patch. Fixed scripts validate patch scope, package structure, dependency allowlists, compilation, tests, and secret patterns. Validation runs without model secrets and without repository write permission. Publishing receives only an already-validated patch and does not execute generated code.

Generation, validation, and publishing run on separate clean GitHub-hosted runners. New code therefore cannot access a model credential or a write-capable GitHub token while it is tested.

## Scheduling

GitHub Actions uses `timezone: Asia/Jerusalem` with a 09:00 cron expression. A concurrency lock and date guard prevent duplicate daily solutions.

## Daily mutation boundary

A daily patch may add exactly one directory under `solutions/` and update `CATALOG.md`. Workflow, validator, policy, or existing-solution changes require a separate human-authored pull request.
