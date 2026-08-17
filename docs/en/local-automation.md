# Local 09:00 automation

The daily runner uses local Claude Code subscription auth, Codex ChatGPT auth, and the signed-in GitHub CLI. It requires no model API key.

Run a read-only preflight:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.automation\local-daily.ps1 -PreflightOnly
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
