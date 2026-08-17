[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepositoryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = Split-Path -Parent $PSScriptRoot
}

$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$configPath = Join-Path $repository ".automation\local-runner.config.json"
$runnerPath = Join-Path $repository ".automation\local-daily.ps1"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "Runner config is missing: $configPath" }
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw "Runner script is missing: $runnerPath" }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ((Get-TimeZone).Id -ne [string]$config.timezone_id) {
    throw "Windows time zone must be $($config.timezone_id) before installing the 09:00 task"
}

$taskName = [string]$config.task_name
$powerShell = Join-Path $PSHOME "powershell.exe"
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -RepositoryPath "{1}"' -f $runnerPath, $repository
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $repository
$dailyTime = [DateTime]::ParseExact([string]$config.daily_time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$trigger = New-ScheduledTaskTrigger -Daily -At $dailyTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$userId = "{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$description = "Local Claude plan, Graphify context compression, Codex build, fixed validation, Claude review, and guarded GitHub publication. No model API keys."

if ($PSCmdlet.ShouldProcess($taskName, "Register daily 09:00 Israel local automation")) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null
    $task = Get-ScheduledTask -TaskName $taskName
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    [pscustomobject]@{
        TaskName = $task.TaskName
        State = $task.State
        NextRunTime = $info.NextRunTime
        Execute = $task.Actions[0].Execute
        Arguments = $task.Actions[0].Arguments
    }
}
