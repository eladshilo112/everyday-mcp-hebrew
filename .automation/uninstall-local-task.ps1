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
$config = Get-Content -LiteralPath (Join-Path $repository ".automation\local-runner.config.json") -Raw | ConvertFrom-Json
$taskName = [string]$config.task_name
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    if ($PSCmdlet.ShouldProcess($taskName, "Unregister local daily automation")) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}
