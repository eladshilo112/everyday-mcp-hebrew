# Architecture

The repository separates end-user MCP packages from the local daily engineering pipeline.

Each folder under `solutions/` is self-contained. Servers use MCP over stdio, keep stdout protocol-clean, return structured content, and are local-first, deterministic, non-destructive, and telemetry-free.

The daily pipeline runs on the owner's Windows computer and creates a fresh disposable clone under `%LOCALAPPDATA%\EverydayMcpHebrew\runs`. It never asks a model to work in the user's main worktree.

1. Preflight verifies local Claude Code subscription auth, Codex ChatGPT auth, GitHub CLI auth, WSL, and Graphify.
2. Graphify refreshes its local AST graph and returns a targeted planning subgraph.
3. Claude returns a plan through a closed JSON schema.
4. Deterministic topic policy validates the category and prohibited phrases.
5. Graphify returns a second, implementation-specific subgraph.
6. Codex may change only one new solution folder and `CATALOG.md`.
7. Fixed validators enforce paths, dependencies, compilation, tests, real MCP stdio integration, audit, secrets, topic policy, and catalog integrity.
8. Graphify refreshes the impact map and Claude performs a bounded final review.
9. Preflight verifies that `main` strictly requires the `validate` check, enforces protection for administrators, and forbids force pushes and branch deletion.
10. The runner creates a branch and pull request. Required GitHub CI gates squash auto-merge.

Graphify is also the context compression layer. Its query output and every model prompt have fixed character budgets. The local report records prompt characters, a clearly labeled four-characters-per-token estimate, and any actual usage metadata returned by Claude. The end-user MCP packages do not depend on Graphify.

The pipeline fails closed on expired auth, network failure, weakened branch protection, duplicate dates, concurrency, invalid model output, unexpected paths, failed tests, policy findings, or review rejection. If a late failure occurs after a branch push, the runner closes its pull request and attempts to delete only the branch it owns. Failed clones are preserved for diagnosis. There is no force push and no direct write to `main`.
