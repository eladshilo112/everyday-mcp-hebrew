# Local 09:00 automation

The daily runner uses local Claude Code subscription auth, Codex ChatGPT auth, and the signed-in GitHub CLI. It requires no model API key.

Claude remains the primary planner and reviewer. Only two explicit Claude availability failures may activate the configured fallback: the monthly spend limit or an expired local OAuth token. The fallback uses two separate ephemeral Codex sessions in the read-only sandbox, one for planning and one for final review. Codex implementation remains a third, separate workspace-write session. Reports record `planner_backend`, `reviewer_backend`, `degraded_model_independence`, and the exact fallback reason. Graphify checks, deterministic validation, secret scanning, branch protection, CI, and rollback remain mandatory. Every other Claude failure fails closed. Re-authenticating Claude automatically restores it as the primary backend.

The final-review contract also fails closed on an internally inconsistent result. `approve` is valid only with `policy_ok=true`, `tests_ok=true`, and no material findings. If a reviewer returns `approve` with material findings, the runner may perform one configured, tool-free classification-only retry. The retry may either move genuinely non-blocking caveats into the summary or reject with blocking findings; it cannot add findings, rerun the review, loop, or bypass the unchanged gate. Reports preserve the initial and final decisions and the exact decision reason.

Run a read-only preflight:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\local-daily.ps1 -PreflightOnly
```

Run the local regression checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\test-local-daily.ps1
```

Run the complete pipeline without GitHub publication:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\local-daily.ps1 -DryRun
```

Install the Windows scheduled task:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\install-local-task.ps1
```

The task runs daily at 09:00 local Israel time, catches up after downtime, and ignores overlapping starts. Reports are stored under `%LOCALAPPDATA%\EverydayMcpHebrew\runs`. Failed disposable clones are preserved for diagnosis.

Remove only the scheduled task:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\uninstall-local-task.ps1
```
