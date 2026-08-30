[CmdletBinding()]
param(
    [string]$RepositoryPath,
    [switch]$PreflightOnly,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = Split-Path -Parent $PSScriptRoot
}

$script:LogPath = $null
$script:ReportPath = $null
$script:Report = [ordered]@{
    version = 1
    status = "starting"
    started_at_utc = [DateTime]::UtcNow.ToString("o")
    mode = if ($PreflightOnly) { "preflight" } elseif ($DryRun) { "dry-run" } else { "publish" }
    degraded_model_independence = $false
    context_metrics = [ordered]@{}
    stages = [ordered]@{}
}
$script:PublicationState = [ordered]@{
    repository = $null
    wsl_exe = $null
    wsl_repo = $null
    branch = $null
    branch_owned = $false
    pr_url = $null
    merged = $false
}

function Write-Utf8NoBom {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-CodexCompatiblePlanSchema {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )
    $schema = Get-Content -LiteralPath $SourcePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $toolNames = $schema.properties.tool_names
    if ($toolNames.PSObject.Properties.Name -contains "uniqueItems") {
        $toolNames.PSObject.Properties.Remove("uniqueItems")
    }
    Write-Utf8NoBom -Path $DestinationPath -Text ($schema | ConvertTo-Json -Depth 20)
}

function Write-RunLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $line = "{0} {1}" -f [DateTime]::UtcNow.ToString("o"), $Message
    Write-Host $line
    if ($null -ne $script:LogPath) {
        [System.IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine)
    }
}

function Save-Report {
    if ($null -eq $script:ReportPath) { return }
    $script:Report["finished_at_utc"] = [DateTime]::UtcNow.ToString("o")
    Write-Utf8NoBom -Path $script:ReportPath -Text ($script:Report | ConvertTo-Json -Depth 20)
}

function Resolve-RequiredFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Convert-ToWindowsCommandLineArgument {
    param([AllowEmptyString()][string]$Argument)
    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"\\]') { return $Argument }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            if ($backslashes -gt 0) { [void]$builder.Append((('\' * ($backslashes * 2)) -join '')) }
            [void]$builder.Append('\"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) { [void]$builder.Append((('\' * $backslashes) -join '')) }
        [void]$builder.Append($character)
        $backslashes = 0
    }
    if ($backslashes -gt 0) { [void]$builder.Append((('\' * ($backslashes * 2)) -join '')) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-Captured {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory,
        [AllowNull()][string]$InputText = $null,
        [string]$StdoutPath,
        [string]$StderrPath,
        [switch]$AllowFailure
    )
    if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        $WorkingDirectory = (Get-Location).Path
    }
    if ($null -ne $InputText) {
        $captureRoot = Join-Path $env:TEMP ("everyday-mcp-capture-" + [Guid]::NewGuid().ToString("N"))
        try {
            New-Item -ItemType Directory -Path $captureRoot -Force | Out-Null
            $inputPath = Join-Path $captureRoot "stdin.utf8"
            $effectiveStdoutPath = if ([string]::IsNullOrWhiteSpace($StdoutPath)) { Join-Path $captureRoot "stdout.utf8" } else { $StdoutPath }
            $effectiveStderrPath = if ([string]::IsNullOrWhiteSpace($StderrPath)) { Join-Path $captureRoot "stderr.utf8" } else { $StderrPath }
            Write-Utf8NoBom -Path $inputPath -Text $InputText
            $argumentLine = (($Arguments | ForEach-Object { Convert-ToWindowsCommandLineArgument -Argument ([string]$_) }) -join ' ')
            $process = Start-Process -FilePath $FilePath -ArgumentList $argumentLine -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru -RedirectStandardInput $inputPath -RedirectStandardOutput $effectiveStdoutPath -RedirectStandardError $effectiveStderrPath
            $exitCode = $process.ExitCode
            $outputRaw = Get-Content -LiteralPath $effectiveStdoutPath -Raw -Encoding UTF8
            $errorRaw = Get-Content -LiteralPath $effectiveStderrPath -Raw -Encoding UTF8
            $outputText = if ($null -eq $outputRaw) { "" } else { ([string]$outputRaw).TrimEnd() }
            $errorText = if ($null -eq $errorRaw) { "" } else { ([string]$errorRaw).TrimEnd() }
        }
        finally {
            if (Test-Path -LiteralPath $captureRoot) {
                Remove-Item -LiteralPath $captureRoot -Recurse -Force
            }
        }
        if ($exitCode -ne 0 -and -not $AllowFailure) {
            $safeError = if ([string]::IsNullOrWhiteSpace($errorText)) { "no stderr" } else { ($errorText -split "`r?`n")[0] }
            throw "Command failed with exit code ${exitCode}: $FilePath. $safeError"
        }
        return [pscustomobject]@{ ExitCode = $exitCode; Output = $outputText; Error = $errorText }
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $false
    $startInfo.Arguments = (($Arguments | ForEach-Object { Convert-ToWindowsCommandLineArgument -Argument ([string]$_) }) -join ' ')
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    try { $startInfo.StandardOutputEncoding = $utf8 } catch { }
    try { $startInfo.StandardErrorEncoding = $utf8 } catch { }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Could not start process: $FilePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    $outputText = $stdoutTask.Result.TrimEnd()
    $errorText = $stderrTask.Result.TrimEnd()
    $process.Dispose()
    if (-not [string]::IsNullOrWhiteSpace($StdoutPath)) {
        Write-Utf8NoBom -Path $StdoutPath -Text $outputText
    }
    if (-not [string]::IsNullOrWhiteSpace($StderrPath)) {
        Write-Utf8NoBom -Path $StderrPath -Text $errorText
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        $safeError = if ([string]::IsNullOrWhiteSpace($errorText)) { "no stderr" } else { ($errorText -split "`r?`n")[0] }
        throw "Command failed with exit code ${exitCode}: $FilePath. $safeError"
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $outputText; Error = $errorText }
}

function Invoke-Wsl {
    param(
        [Parameter(Mandatory = $true)][string]$WslExe,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$StdoutPath,
        [string]$StderrPath,
        [switch]$AllowFailure
    )
    return Invoke-Captured -FilePath $WslExe -Arguments (@("-d", "Ubuntu", "--") + $Arguments) -StdoutPath $StdoutPath -StderrPath $StderrPath -AllowFailure:$AllowFailure
}

function Convert-ToWslPath {
    param([Parameter(Mandatory = $true)][string]$WslExe, [Parameter(Mandatory = $true)][string]$WindowsPath)
    $result = Invoke-Wsl -WslExe $WslExe -Arguments @("wslpath", "-a", "-u", $WindowsPath)
    return $result.Output.Trim()
}

function Undo-UnmergedPublication {
    if ($script:PublicationState.merged) { return "not_needed_merged" }
    if ([string]::IsNullOrWhiteSpace([string]$script:PublicationState.repository) -or [string]::IsNullOrWhiteSpace([string]$script:PublicationState.wsl_exe)) {
        return "not_needed_before_publication"
    }
    $repositoryName = [string]$script:PublicationState.repository
    $wslExe = [string]$script:PublicationState.wsl_exe
    $prUrl = [string]$script:PublicationState.pr_url
    $branch = [string]$script:PublicationState.branch
    if ([string]::IsNullOrWhiteSpace($prUrl) -and (-not $script:PublicationState.branch_owned -or [string]::IsNullOrWhiteSpace($branch))) {
        return "not_needed_before_publication"
    }
    if (-not [string]::IsNullOrWhiteSpace($prUrl)) {
        $view = Invoke-Wsl -WslExe $wslExe -Arguments @("gh", "pr", "view", "-R", $repositoryName, $prUrl, "--json", "state") -AllowFailure
        if ($view.ExitCode -eq 0) {
            $state = $view.Output | ConvertFrom-Json
            if ([string]$state.state -eq "MERGED") {
                $script:PublicationState.merged = $true
                return "not_needed_already_merged"
            }
        }
        Invoke-Wsl -WslExe $wslExe -Arguments @("gh", "pr", "close", "-R", $repositoryName, $prUrl, "--delete-branch") -AllowFailure | Out-Null
    }
    $wslRepo = [string]$script:PublicationState.wsl_repo
    if ($script:PublicationState.branch_owned -and -not [string]::IsNullOrWhiteSpace($branch) -and -not [string]::IsNullOrWhiteSpace($wslRepo)) {
        Invoke-Wsl -WslExe $wslExe -Arguments @("git", "-C", $wslRepo, "push", "origin", "--delete", $branch) -AllowFailure | Out-Null
    }
    return "attempted_for_unmerged_publication"
}

function Limit-Context {
    param([Parameter(Mandatory = $true)][string]$Text, [Parameter(Mandatory = $true)][int]$MaximumCharacters)
    if ($Text.Length -le $MaximumCharacters) { return $Text }
    return $Text.Substring(0, $MaximumCharacters) + "`n[GRAPHIFY_CONTEXT_TRUNCATED_TO_BUDGET]"
}

function Assert-ContextBudget {
    param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Text, [Parameter(Mandatory = $true)][int]$MaximumCharacters)
    if ($Text.Length -gt $MaximumCharacters) {
        throw "$Name exceeded its fixed context budget: $($Text.Length) > $MaximumCharacters characters"
    }
    $script:Report.context_metrics[$Name + "_chars"] = $Text.Length
    $script:Report.context_metrics[$Name + "_estimated_tokens_at_4_chars"] = [Math]::Ceiling($Text.Length / 4.0)
}

function Invoke-GraphQuery {
    param(
        [Parameter(Mandatory = $true)][string]$GraphifyExe,
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Question,
        [Parameter(Mandatory = $true)][int]$Budget,
        [Parameter(Mandatory = $true)][string]$EvidencePath
    )
    $result = Invoke-Captured -FilePath $GraphifyExe -Arguments @("query", $Question) -WorkingDirectory $Repository -StderrPath ($EvidencePath + ".stderr")
    $limited = Limit-Context -Text $result.Output -MaximumCharacters $Budget
    Write-Utf8NoBom -Path $EvidencePath -Text $limited
    return $limited
}

function Get-ClaudeStructuredOutput {
    param([Parameter(Mandatory = $true)][string]$JsonText)
    $envelope = $JsonText | ConvertFrom-Json
    if ($null -eq $envelope.structured_output) {
        throw "Claude did not return structured_output"
    }
    return [pscustomobject]@{ Envelope = $envelope; Value = $envelope.structured_output }
}

function Get-ClaudeFailureMessage {
    param([AllowEmptyString()][string]$JsonText)
    if ([string]::IsNullOrWhiteSpace($JsonText)) { return "Claude returned no structured error output" }
    try {
        $envelope = $JsonText | ConvertFrom-Json
        if ($envelope.PSObject.Properties.Name -contains "result" -and -not [string]::IsNullOrWhiteSpace([string]$envelope.result)) {
            $message = (([string]$envelope.result) -replace '\s+', ' ').Trim()
            if ($message.Length -gt 300) { return $message.Substring(0, 300) }
            return $message
        }
    }
    catch { }
    return "Claude returned an unreadable structured error envelope"
}

function Get-CodexFailureMessage {
    param([AllowEmptyString()][string]$ErrorText)
    if ([string]::IsNullOrWhiteSpace($ErrorText)) { return "Codex returned no stderr" }
    $errorLines = @($ErrorText -split "`r?`n" | Where-Object { $_.Trim() -match '^ERROR:' })
    $message = if ($errorLines.Count -gt 0) { [string]$errorLines[0] } else { [string](($ErrorText -split "`r?`n")[0]) }
    $message = ($message -replace '\s+', ' ').Trim()
    if ($message.Length -gt 300) { return $message.Substring(0, 300) }
    return $message
}

function Get-ReviewDecision {
    param([Parameter(Mandatory = $true)]$Review)

    if ($Review.verdict -isnot [string]) {
        return [pscustomobject]@{ Pass = $false; Reason = "verdict_type_invalid" }
    }
    if ([string]$Review.verdict -ne "approve") {
        return [pscustomobject]@{ Pass = $false; Reason = "verdict_not_approve" }
    }
    if ($Review.policy_ok -isnot [bool]) {
        return [pscustomobject]@{ Pass = $false; Reason = "policy_type_invalid" }
    }
    if (-not $Review.policy_ok) {
        return [pscustomobject]@{ Pass = $false; Reason = "policy_failed" }
    }
    if ($Review.tests_ok -isnot [bool]) {
        return [pscustomobject]@{ Pass = $false; Reason = "tests_type_invalid" }
    }
    if (-not $Review.tests_ok) {
        return [pscustomobject]@{ Pass = $false; Reason = "tests_failed" }
    }
    if (@($Review.material_findings).Count -ne 0) {
        return [pscustomobject]@{ Pass = $false; Reason = "approve_with_material_findings_inconsistent" }
    }
    return [pscustomobject]@{ Pass = $true; Reason = "approved" }
}

function New-ReviewReclassificationPrompt {
    param([Parameter(Mandatory = $true)]$Review)

    $priorReviewJson = $Review | ConvertTo-Json -Depth 12 -Compress
    return @"
The prior structured review is internally inconsistent: it returned verdict=approve while material_findings is non-empty.
Do not perform a new review and do not introduce new findings. Reclassify only the supplied prior findings.
If every prior finding is non-blocking, return verdict=approve, preserve policy_ok=true and tests_ok=true, set material_findings to [], and mention any useful caveats in summary.
If any prior finding is genuinely blocking, return verdict=reject and keep only blocking issues in material_findings.
The invariant is strict: approve requires an empty material_findings array. Only blockers belong in material_findings; non-blocking observations, style notes, and suggestions belong in summary.

PRIOR STRUCTURED REVIEW
$priorReviewJson
"@
}

function Test-ClaudeMonthlySpendLimit {
    param([AllowEmptyString()][string]$Message)
    return -not [string]::IsNullOrWhiteSpace($Message) -and $Message -match '(?i)monthly spend limit'
}

function Get-ClaudeFallbackReason {
    param([AllowEmptyString()][string]$Message)
    if (Test-ClaudeMonthlySpendLimit -Message $Message) { return "CLAUDE_MONTHLY_SPEND_LIMIT" }
    if (-not [string]::IsNullOrWhiteSpace($Message) -and $Message -match '(?i)401 OAuth access token has expired') {
        return "CLAUDE_OAUTH_EXPIRED"
    }
    return $null
}

function Invoke-ClaudeStructuredWithCodexFallback {
    param(
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Claude,
        [Parameter(Mandatory = $true)][string[]]$ClaudeArguments,
        [Parameter(Mandatory = $true)][string]$Codex,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$FallbackSystemPrompt,
        [Parameter(Mandatory = $true)][string]$SchemaPath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$ClaudeStdoutPath,
        [Parameter(Mandatory = $true)][string]$ClaudeStderrPath,
        [Parameter(Mandatory = $true)][string]$CodexResultPath,
        [Parameter(Mandatory = $true)][string]$CodexStdoutPath,
        [Parameter(Mandatory = $true)][string]$CodexStderrPath,
        [Parameter(Mandatory = $true)][bool]$FallbackEnabled,
        [string[]]$CodexPrefixArguments = @()
    )
    $claudeRun = Invoke-Captured -FilePath $Claude -Arguments $ClaudeArguments -WorkingDirectory $WorkingDirectory -InputText $Prompt -StdoutPath $ClaudeStdoutPath -StderrPath $ClaudeStderrPath -AllowFailure
    if ($claudeRun.ExitCode -eq 0) {
        $structured = Get-ClaudeStructuredOutput -JsonText $claudeRun.Output
        return [pscustomobject]@{
            Backend = "claude"
            Envelope = $structured.Envelope
            Value = $structured.Value
            ClaudeFailure = $null
        }
    }

    $failureMessage = Get-ClaudeFailureMessage -JsonText $claudeRun.Output
    $fallbackReason = Get-ClaudeFallbackReason -Message $failureMessage
    if (-not $FallbackEnabled -or $null -eq $fallbackReason) {
        throw "Claude $Stage failed: $failureMessage"
    }

    Write-RunLog "Claude $Stage is unavailable with $fallbackReason. Starting an isolated read-only Codex fallback."
    $fallbackPrompt = $FallbackSystemPrompt + "`n`n" + $Prompt
    $codexArguments = @($CodexPrefixArguments) + @(
        "exec", "-",
        "--sandbox", "read-only",
        "--cd", $WorkingDirectory,
        "--ephemeral",
        "--ignore-user-config",
        "--output-schema", $SchemaPath,
        "--output-last-message", $CodexResultPath,
        "--color", "never"
    )
    $codexRun = Invoke-Captured -FilePath $Codex -Arguments $codexArguments -WorkingDirectory $WorkingDirectory -InputText $fallbackPrompt -StdoutPath $CodexStdoutPath -StderrPath $CodexStderrPath -AllowFailure
    if ($codexRun.ExitCode -ne 0) {
        throw "Codex $Stage fallback failed: $(Get-CodexFailureMessage -ErrorText $codexRun.Error)"
    }
    if (-not (Test-Path -LiteralPath $CodexResultPath -PathType Leaf)) {
        throw "Codex $Stage fallback did not produce a structured result"
    }
    $value = Get-Content -LiteralPath $CodexResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return [pscustomobject]@{
        Backend = "codex_availability_fallback"
        Envelope = $null
        Value = $value
        ClaudeFailure = $fallbackReason
    }
}

function Assert-PlanIdentity {
    param($Plan, [string]$ExpectedId, [string]$ExpectedDate)
    if ($Plan.solution_id -ne $ExpectedId) { throw "Claude plan solution_id does not match preflight" }
    if ($Plan.date -ne $ExpectedDate) { throw "Claude plan date does not match Jerusalem date" }
    if ([string]$Plan.slug -notmatch "^[a-z0-9]+(?:-[a-z0-9]+)*$") { throw "Claude plan slug is invalid" }
    if ($Plan.include_skill -and [string]::IsNullOrWhiteSpace([string]$Plan.skill_name)) { throw "Claude requested a skill without a skill_name" }
    if (-not $Plan.include_skill -and -not [string]::IsNullOrWhiteSpace([string]$Plan.skill_name)) { throw "Claude returned a skill_name while include_skill is false" }
}

function Get-RepositoryTextBytes {
    param([Parameter(Mandatory = $true)][string]$Repository)
    $ignored = @(".git", "node_modules", "dist", "graphify-out", ".claude", ".codex")
    $extensions = @(".md", ".json", ".ts", ".js", ".py", ".ps1", ".yml", ".yaml", ".xml", ".toml")
    $total = [int64]0
    Get-ChildItem -LiteralPath $Repository -File -Recurse | ForEach-Object {
        $relative = $_.FullName.Substring($Repository.Length).TrimStart("\")
        $parts = $relative -split "[\\/]"
        if (@($parts | Where-Object { $ignored -contains $_ }).Count -eq 0 -and $extensions -contains $_.Extension.ToLowerInvariant()) {
            $total += $_.Length
        }
    }
    return $total
}

function Main {
    $repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
    $configPath = Resolve-RequiredFile -Path (Join-Path $repository ".automation\local-runner.config.json") -Label "Runner config"
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $codexAvailabilityFallbackEnabled = (
        $config.PSObject.Properties.Name -contains "fallbacks" -and
        $null -ne $config.fallbacks -and
        $config.fallbacks.PSObject.Properties.Name -contains "codex_on_claude_known_unavailability" -and
        [bool]$config.fallbacks.codex_on_claude_known_unavailability
    )
    $reviewReclassificationEnabled = (
        $config.PSObject.Properties.Name -contains "review" -and
        $null -ne $config.review -and
        $config.review.PSObject.Properties.Name -contains "reclassify_inconsistent_approve_once" -and
        $config.review.reclassify_inconsistent_approve_once -is [bool] -and
        $config.review.reclassify_inconsistent_approve_once
    )
    $planSchemaPath = Resolve-RequiredFile -Path (Join-Path $repository ".automation\local-plan.schema.json") -Label "Plan schema"
    $codexSchemaPath = Resolve-RequiredFile -Path (Join-Path $repository ".automation\local-codex-result.schema.json") -Label "Codex result schema"
    $reviewSchemaPath = Resolve-RequiredFile -Path (Join-Path $repository ".automation\local-review.schema.json") -Label "Review schema"
    $claude = Resolve-RequiredFile -Path (Join-Path $env:USERPROFILE ".local\bin\claude.exe") -Label "Claude Code"
    $graphify = Resolve-RequiredFile -Path (Join-Path $env:USERPROFILE ".local\bin\graphify.exe") -Label "Graphify"
    $wsl = Resolve-RequiredFile -Path (Join-Path $env:WINDIR "System32\wsl.exe") -Label "WSL"
    $codexCandidates = @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin\*\codex.exe") -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($codexCandidates.Count -eq 0) { throw "A signed-in Codex CLI binary was not found under LocalAppData" }
    $codex = $codexCandidates[0].FullName

    Write-RunLog "Preflight: checking local subscription authentication and required tools."
    $claudeAuth = Invoke-Captured -FilePath $claude -Arguments @("auth", "status") -WorkingDirectory $repository
    $claudeAuthJson = $claudeAuth.Output | ConvertFrom-Json
    if (-not $claudeAuthJson.loggedIn) { throw "Claude Code subscription authentication is not active" }
    $codexAuth = Invoke-Captured -FilePath $codex -Arguments @("login", "status") -WorkingDirectory $repository
    $codexAuthStatus = $codexAuth.Output + "`n" + $codexAuth.Error
    if ($codexAuthStatus -notmatch "Logged in") { throw "Codex ChatGPT authentication is not active" }
    Invoke-Wsl -WslExe $wsl -Arguments @("gh", "auth", "status") | Out-Null
    Invoke-Wsl -WslExe $wsl -Arguments @("gh", "repo", "view", [string]$config.repository, "--json", "nameWithOwner") | Out-Null
    $protection = (Invoke-Wsl -WslExe $wsl -Arguments @("gh", "api", "repos/$($config.repository)/branches/$($config.default_branch)/protection")).Output | ConvertFrom-Json
    $requiredContexts = @($protection.required_status_checks.contexts)
    if (-not $protection.required_status_checks.strict -or $requiredContexts -notcontains "validate") {
        throw "Branch protection must require strict validate status checks"
    }
    if (-not $protection.enforce_admins.enabled -or $protection.allow_force_pushes.enabled -or $protection.allow_deletions.enabled) {
        throw "Branch protection must enforce admins and forbid force pushes and deletion"
    }
    Invoke-Captured -FilePath $graphify -Arguments @("--version") -WorkingDirectory $repository | Out-Null
    $script:Report.stages["preflight"] = "passed"

    if ($PreflightOnly) {
        $script:Report.status = "preflight_passed"
        Write-RunLog "Preflight passed. No repository or GitHub changes were made."
        return
    }

    $mutex = New-Object System.Threading.Mutex($false, "Local\EverydayMcpHebrewDaily")
    if (-not $mutex.WaitOne(0)) { throw "Another daily runner instance is already active" }
    try {
        $stateRoot = Join-Path $env:LOCALAPPDATA ([string]$config.state_folder)
        $runId = "{0}-{1}" -f [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
        $runDir = Join-Path $stateRoot ("runs\" + $runId)
        New-Item -ItemType Directory -Path $runDir -Force | Out-Null
        $script:LogPath = Join-Path $runDir "runner.log"
        $script:ReportPath = Join-Path $runDir "run-report.json"
        $script:Report["run_id"] = $runId
        $script:Report["run_directory"] = $runDir
        Write-RunLog "Run directory created."

        $runRepo = Join-Path $runDir "repo"
        $wslRepo = Convert-ToWslPath -WslExe $wsl -WindowsPath $runRepo
        $script:PublicationState.repository = [string]$config.repository
        $script:PublicationState.wsl_exe = $wsl
        $script:PublicationState.wsl_repo = $wslRepo
        $clone = Invoke-Wsl -WslExe $wsl -Arguments @("git", "clone", "--depth", "1", "--branch", [string]$config.default_branch, [string]$config.remote_url, $wslRepo) -StdoutPath (Join-Path $runDir "clone.stdout") -StderrPath (Join-Path $runDir "clone.stderr")
        $baseHead = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "rev-parse", "HEAD")).Output.Trim()
        $script:Report["base_head"] = $baseHead

        $preflightJson = (Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/daily_preflight.py", "--root", $wslRepo)).Output | ConvertFrom-Json
        $date = [string]$preflightJson.date
        $solutionId = [string]$preflightJson.solution_id
        $script:Report["jerusalem_date"] = $date
        $script:Report["solution_id"] = $solutionId
        if ([string]$preflightJson.should_run -ne "true") {
            $script:Report.status = "duplicate_date_noop"
            Write-RunLog "A solution already exists for the current Jerusalem date. No-op."
            return
        }

        Write-RunLog "Graphify: refreshing the disposable clone before planning."
        Invoke-Captured -FilePath $graphify -Arguments @("update", ".", "--no-cluster") -WorkingDirectory $runRepo -StdoutPath (Join-Path $runDir "graphify-before.stdout") -StderrPath (Join-Path $runDir "graphify-before.stderr") | Out-Null
        $graphBudget = [int]$config.context_budgets.graph_query_chars
        $planGraph = Invoke-GraphQuery -GraphifyExe $graphify -Repository $runRepo -Question "Map the existing daily MCP solutions, catalog topics, validators, dependency allowlist, documentation pattern, and exact relationships needed to add one non-duplicative solution. Return only the most relevant files and relationships." -Budget $graphBudget -EvidencePath (Join-Path $runDir "graphify-plan.txt")
        $catalog = Get-Content -LiteralPath (Join-Path $runRepo "CATALOG.md") -Raw -Encoding UTF8
        $policy = Get-Content -LiteralPath (Join-Path $runRepo ".automation\content-policy.json") -Raw -Encoding UTF8
        $baselineBytes = Get-RepositoryTextBytes -Repository $runRepo
        $script:Report.context_metrics["repository_text_bytes_baseline"] = $baselineBytes

        $planPrompt = @"
You are the read-only planner for public solution $solutionId dated $date.
Choose one genuinely common everyday problem that is not already in the catalog.
The audience is an ordinary Claude Code, Codex, or MCP client user.
Use Graphify's targeted map below as the engineering context. Do not request the full repository.
The solution must be local-first, deterministic, stdio MCP, useful without an account, and safe by default.
It may optionally include one improved reusable skill under skill/SKILL.md when that materially improves use.
It must not use personal or private material, credentials, destructive actions, telemetry, purchases, or hidden network activity.
The category must be one of the policy allowlist. All policy deny phrases are forbidden in public content.
Return only the JSON required by the supplied schema. Do not use tools or edit files.

GRAPHIFY TARGETED CONTEXT
$planGraph

CONTENT POLICY
$policy

CURRENT CATALOG
$catalog
"@
        Assert-ContextBudget -Name "plan_prompt" -Text $planPrompt -MaximumCharacters ([int]$config.context_budgets.plan_prompt_chars)
        $planPromptPath = Join-Path $runDir "claude-plan.prompt.txt"
        Write-Utf8NoBom -Path $planPromptPath -Text $planPrompt
        $planSchema = (Get-Content -LiteralPath $planSchemaPath -Raw -Encoding UTF8 | ConvertFrom-Json) | ConvertTo-Json -Depth 20 -Compress
        $codexPlanSchemaPath = Join-Path $runDir "codex-plan.schema.json"
        Write-CodexCompatiblePlanSchema -SourcePath $planSchemaPath -DestinationPath $codexPlanSchemaPath
        $planSystemPrompt = "You are a constrained public open-source MCP planner. Follow the supplied task and return only the required structured JSON. Do not use tools or infer private context."
        $planResult = Invoke-ClaudeStructuredWithCodexFallback -Stage "plan" -Claude $claude -ClaudeArguments @("-p", "--safe-mode", "--system-prompt", $planSystemPrompt, "--permission-mode", "plan", "--model", "sonnet", "--effort", "medium", "--output-format", "json", "--max-turns", "3", "--no-session-persistence", "--json-schema", $planSchema, "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task") -Codex $codex -Prompt $planPrompt -FallbackSystemPrompt $planSystemPrompt -SchemaPath $codexPlanSchemaPath -WorkingDirectory $runRepo -ClaudeStdoutPath (Join-Path $runDir "claude-plan.output.json") -ClaudeStderrPath (Join-Path $runDir "claude-plan.stderr") -CodexResultPath (Join-Path $runDir "codex-plan.output.json") -CodexStdoutPath (Join-Path $runDir "codex-plan.stdout") -CodexStderrPath (Join-Path $runDir "codex-plan.stderr") -FallbackEnabled $codexAvailabilityFallbackEnabled
        $plan = $planResult.Value
        Assert-PlanIdentity -Plan $plan -ExpectedId $solutionId -ExpectedDate $date
        $planJson = $plan | ConvertTo-Json -Depth 20
        $planPath = Join-Path $runDir "validated-plan.json"
        Write-Utf8NoBom -Path $planPath -Text $planJson
        $wslPlanPath = Convert-ToWslPath -WslExe $wsl -WindowsPath $planPath
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_topic_policy.py", $wslPlanPath, "--category", [string]$plan.category) | Out-Null
        $script:Report["planner_backend"] = $planResult.Backend
        if ($planResult.Backend -ne "claude") {
            $script:Report.degraded_model_independence = $true
            $script:Report["planner_fallback_reason"] = $planResult.ClaudeFailure
        }
        if ($null -ne $planResult.Envelope -and $null -ne $planResult.Envelope.usage) { $script:Report["claude_plan_usage"] = $planResult.Envelope.usage }
        $script:Report["slug"] = [string]$plan.slug
        $script:Report["category"] = [string]$plan.category
        $script:Report.stages["claude_plan"] = "passed"
        Write-RunLog "Claude plan accepted by the closed schema and topic policy."

        $solutionRelative = "solutions/$solutionId-$($plan.slug)"
        if (Test-Path -LiteralPath (Join-Path $runRepo ($solutionRelative -replace "/", "\"))) { throw "Planned solution folder already exists" }
        $implementationGraph = Invoke-GraphQuery -GraphifyExe $graphify -Repository $runRepo -Question "For solution $solutionId-$($plan.slug), identify only the exact template files, MCP server patterns, validation gates, catalog format, test contracts, and impact paths Codex must follow." -Budget $graphBudget -EvidencePath (Join-Path $runDir "graphify-implementation.txt")
        $implementationPrompt = @"
Implement the inert validated plan below in this disposable clone.
Use Graphify first for targeted navigation. Do not broadly read the repository when the graph answers the question.
You may write only $solutionRelative/ and CATALOG.md.
Do not commit, push, open a pull request, use the network, install packages, or modify existing solutions, policies, workflows, scripts, tests, Graphify configuration, or documentation outside the new solution.
Do not include package-lock.json. The fixed validator will generate it without lifecycle scripts.
Build a working TypeScript stdio MCP server with structuredContent and accurate read-only annotations.
Include Hebrew-first RTL README, metadata, source, at least four test files including a real stdio MCP integration test, ten stable evaluations, and an optional skill/SKILL.md only when include_skill is true.
Use exactly the pinned dependencies enforced by scripts/validate_solution.py.
All behavior must be deterministic, local-first, non-destructive, without telemetry or hidden network activity.
When finished, return only the result object required by the supplied output schema.

VALIDATED PLAN
$planJson

GRAPHIFY TARGETED IMPLEMENTATION CONTEXT
$implementationGraph
"@
        Assert-ContextBudget -Name "implementation_prompt" -Text $implementationPrompt -MaximumCharacters ([int]$config.context_budgets.implementation_prompt_chars)
        Write-Utf8NoBom -Path (Join-Path $runDir "codex-implementation.prompt.txt") -Text $implementationPrompt
        $codexResultPath = Join-Path $runRepo ".automation\codex-local-result.output.json"
        $codexStdout = Join-Path $runDir "codex-events.stdout"
        $codexRun = Invoke-Captured -FilePath $codex -Arguments @("exec", "-", "--sandbox", "workspace-write", "--cd", $runRepo, "--ephemeral", "--output-schema", $codexSchemaPath, "--output-last-message", $codexResultPath, "--color", "never") -WorkingDirectory $runRepo -InputText $implementationPrompt -StdoutPath $codexStdout -StderrPath (Join-Path $runDir "codex.stderr")
        $codexResult = Get-Content -LiteralPath $codexResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([string]$codexResult.solution_id -ne $solutionId -or [string]$codexResult.slug -ne [string]$plan.slug) { throw "Codex result identity does not match the validated plan" }
        $headAfterCodex = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "rev-parse", "HEAD")).Output.Trim()
        if ($headAfterCodex -ne $baseHead) { throw "Codex created a commit, which is outside its authorization" }
        $script:Report.stages["codex_implementation"] = "completed"
        Write-RunLog "Codex implementation completed inside the disposable clone."

        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_daily_delta.py", "--root", $wslRepo, "--expected-id", $solutionId, "--expected-slug", [string]$plan.slug) -StdoutPath (Join-Path $runDir "delta-before.stdout") -StderrPath (Join-Path $runDir "delta-before.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_solution.py", "$wslRepo/$solutionRelative", "--install", "--audit") -StdoutPath (Join-Path $runDir "solution-validation.stdout") -StderrPath (Join-Path $runDir "solution-validation.stderr") | Out-Null
        $generatedLockPath = Join-Path $runRepo (($solutionRelative + "/package-lock.json") -replace "/", "\")
        if (Test-Path -LiteralPath $generatedLockPath -PathType Leaf) {
            Remove-Item -LiteralPath $generatedLockPath -Force
            $script:Report["generated_package_lock_removed"] = $true
        }
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_daily_delta.py", "--root", $wslRepo, "--expected-id", $solutionId, "--expected-slug", [string]$plan.slug) -StdoutPath (Join-Path $runDir "delta-after.stdout") -StderrPath (Join-Path $runDir "delta-after.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/scan_secrets.py", "$wslRepo/$solutionRelative") -StdoutPath (Join-Path $runDir "secret-scan.stdout") -StderrPath (Join-Path $runDir "secret-scan.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_topic_policy.py", "$wslRepo/$solutionRelative", "--category", [string]$plan.category) -StdoutPath (Join-Path $runDir "topic-policy.stdout") -StderrPath (Join-Path $runDir "topic-policy.stderr") | Out-Null
        $script:Report.stages["deterministic_validation"] = "passed"
        Write-RunLog "Fixed build, MCP integration, audit, secret, delta, and topic gates passed."

        Invoke-Captured -FilePath $graphify -Arguments @("update", ".", "--no-cluster") -WorkingDirectory $runRepo -StdoutPath (Join-Path $runDir "graphify-after.stdout") -StderrPath (Join-Path $runDir "graphify-after.stderr") | Out-Null
        $reviewGraph = Invoke-GraphQuery -GraphifyExe $graphify -Repository $runRepo -Question "Review the impact of $solutionRelative. Identify only boundary violations, unsafe relationships, validator gaps, duplicated purpose, and catalog inconsistencies relevant to approval." -Budget $graphBudget -EvidencePath (Join-Path $runDir "graphify-review.txt")
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "add", "-N", "--", $solutionRelative) | Out-Null
        $diffStat = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--stat", "--", "CATALOG.md", $solutionRelative)).Output
        $interfaceDiffRaw = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--no-ext-diff", "--unified=1", "--", "$solutionRelative/package.json", "$solutionRelative/metadata.json", "$solutionRelative/src/server.ts", "$solutionRelative/src/schemas.ts")).Output
        $coreDiffRaw = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--no-ext-diff", "--unified=1", "--", "$solutionRelative/src")).Output
        $testDiffRaw = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--no-ext-diff", "--unified=1", "--", "$solutionRelative/tests")).Output
        $docsDiffRaw = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--no-ext-diff", "--unified=1", "--", "CATALOG.md", "$solutionRelative/README.md", "$solutionRelative/evaluations.xml")).Output
        $diffExcerpt = @"
INTERFACE AND CLOSED SCHEMAS
$(Limit-Context -Text $interfaceDiffRaw -MaximumCharacters ([int]$config.context_budgets.review_interface_diff_chars))

CORE SOURCE
$(Limit-Context -Text $coreDiffRaw -MaximumCharacters ([int]$config.context_budgets.review_core_diff_chars))

TESTS
$(Limit-Context -Text $testDiffRaw -MaximumCharacters ([int]$config.context_budgets.review_test_diff_chars))

PUBLIC DOCS AND EVALUATIONS
$(Limit-Context -Text $docsDiffRaw -MaximumCharacters ([int]$config.context_budgets.review_docs_diff_chars))
"@
        $reviewPrompt = @"
Act as the final read-only reviewer. Approve only if the validated plan was implemented, the public topic boundary is respected, the MCP is genuinely useful, and the deterministic evidence is sufficient.
Use the targeted Graphify impact context and bounded diff excerpt. Do not use tools or edit files.
The fixed gates already passed: delta boundary, dependency allowlist, TypeScript compilation, all tests including stdio integration, npm high-severity audit, secret scan, topic scan, and catalog validation.
        Return only the JSON required by the supplied review schema. Reject with concise material findings if any blocking issue remains.
        The review decision must be internally consistent: approve requires policy_ok=true, tests_ok=true, and an empty material_findings array. Only blocking issues belong in material_findings. Put non-blocking observations, style notes, dependency curiosities, and suggestions in summary instead.
        Valid example: {"verdict":"approve","policy_ok":true,"tests_ok":true,"material_findings":[],"summary":"The bounded implementation is approved; one non-blocking style note is recorded here."}
        Invalid example: {"verdict":"approve","policy_ok":true,"tests_ok":true,"material_findings":["minor observation"]}

PLAN
$planJson

GRAPHIFY TARGETED IMPACT CONTEXT
$reviewGraph

DIFF STAT
$diffStat

BOUNDED DIFF EXCERPT
$diffExcerpt
"@
        Assert-ContextBudget -Name "review_prompt" -Text $reviewPrompt -MaximumCharacters ([int]$config.context_budgets.review_prompt_chars)
        Write-Utf8NoBom -Path (Join-Path $runDir "claude-review.prompt.txt") -Text $reviewPrompt
        $reviewSchema = (Get-Content -LiteralPath $reviewSchemaPath -Raw -Encoding UTF8 | ConvertFrom-Json) | ConvertTo-Json -Depth 20 -Compress
        $reviewSystemPrompt = "You are a constrained public open-source code reviewer. Judge only the supplied evidence and return only the required structured JSON. Do not use tools or infer private context. Approve only with policy_ok=true, tests_ok=true, and material_findings=[]. Only blocking issues belong in material_findings; put all non-blocking caveats in summary."
        $reviewClaudeArguments = @("-p", "--safe-mode", "--system-prompt", $reviewSystemPrompt, "--permission-mode", "plan", "--model", "sonnet", "--effort", "medium", "--output-format", "json", "--max-turns", "4", "--no-session-persistence", "--json-schema", $reviewSchema, "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task")
        $reviewResult = Invoke-ClaudeStructuredWithCodexFallback -Stage "review" -Claude $claude -ClaudeArguments $reviewClaudeArguments -Codex $codex -Prompt $reviewPrompt -FallbackSystemPrompt $reviewSystemPrompt -SchemaPath $reviewSchemaPath -WorkingDirectory $runRepo -ClaudeStdoutPath (Join-Path $runDir "claude-review.output.json") -ClaudeStderrPath (Join-Path $runDir "claude-review.stderr") -CodexResultPath (Join-Path $runDir "codex-review.output.json") -CodexStdoutPath (Join-Path $runDir "codex-review.stdout") -CodexStderrPath (Join-Path $runDir "codex-review.stderr") -FallbackEnabled $codexAvailabilityFallbackEnabled
        $review = $reviewResult.Value
        $script:Report["reviewer_backend"] = $reviewResult.Backend
        if ($reviewResult.Backend -ne "claude") {
            $script:Report.degraded_model_independence = $true
            $script:Report["reviewer_fallback_reason"] = $reviewResult.ClaudeFailure
        }
        if ($null -ne $reviewResult.Envelope -and $null -ne $reviewResult.Envelope.usage) { $script:Report["claude_review_usage"] = $reviewResult.Envelope.usage }

        $reviewDecision = Get-ReviewDecision -Review $review
        $script:Report["review_reclassification_attempted"] = $false
        if ($reviewDecision.Reason -eq "approve_with_material_findings_inconsistent" -and $reviewReclassificationEnabled) {
            $script:Report["review_initial_backend"] = $reviewResult.Backend
            $script:Report["review_initial_verdict"] = [string]$review.verdict
            $script:Report["review_initial_material_findings"] = @($review.material_findings)
            $script:Report["review_initial_decision_reason"] = $reviewDecision.Reason
            $script:Report["review_reclassification_attempted"] = $true
            Write-RunLog "Review returned approve with material findings. Starting one constrained classification-only retry."

            $reclassificationPrompt = New-ReviewReclassificationPrompt -Review $review
            Write-Utf8NoBom -Path (Join-Path $runDir "review-reclassification.prompt.txt") -Text $reclassificationPrompt
            $reclassificationSystemPrompt = "Correct only the internal classification of the supplied prior review. Do not add findings or perform a new review. Approve requires material_findings=[]. If any supplied finding is blocking, reject. Return only the required structured JSON and use no tools."
            $reclassificationClaudeArguments = @("-p", "--safe-mode", "--system-prompt", $reclassificationSystemPrompt, "--permission-mode", "plan", "--model", "sonnet", "--effort", "medium", "--output-format", "json", "--max-turns", "1", "--no-session-persistence", "--json-schema", $reviewSchema, "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task")
            $reviewResult = Invoke-ClaudeStructuredWithCodexFallback -Stage "review-reclassification" -Claude $claude -ClaudeArguments $reclassificationClaudeArguments -Codex $codex -Prompt $reclassificationPrompt -FallbackSystemPrompt $reclassificationSystemPrompt -SchemaPath $reviewSchemaPath -WorkingDirectory $runRepo -ClaudeStdoutPath (Join-Path $runDir "claude-review-reclassification.output.json") -ClaudeStderrPath (Join-Path $runDir "claude-review-reclassification.stderr") -CodexResultPath (Join-Path $runDir "codex-review-reclassification.output.json") -CodexStdoutPath (Join-Path $runDir "codex-review-reclassification.stdout") -CodexStderrPath (Join-Path $runDir "codex-review-reclassification.stderr") -FallbackEnabled $codexAvailabilityFallbackEnabled
            $review = $reviewResult.Value
            $script:Report["review_reclassification_backend"] = $reviewResult.Backend
            $script:Report["reviewer_backend"] = $reviewResult.Backend
            if ($reviewResult.Backend -ne "claude") {
                $script:Report.degraded_model_independence = $true
                $script:Report["review_reclassification_fallback_reason"] = $reviewResult.ClaudeFailure
            }
            if ($null -ne $reviewResult.Envelope -and $null -ne $reviewResult.Envelope.usage) { $script:Report["claude_review_reclassification_usage"] = $reviewResult.Envelope.usage }
            $reviewDecision = Get-ReviewDecision -Review $review
        }

        $script:Report["review_verdict"] = [string]$review.verdict
        $script:Report["review_material_findings"] = @($review.material_findings)
        $script:Report["review_decision_reason"] = $reviewDecision.Reason
        if (-not $reviewDecision.Pass) {
            throw "Independent review did not approve the generated solution: $($reviewDecision.Reason)"
        }
        $script:Report.stages["claude_review"] = "approved"
        $script:Report.stages["independent_review"] = "approved"
        $promptChars = [int64]$script:Report.context_metrics.plan_prompt_chars + [int64]$script:Report.context_metrics.implementation_prompt_chars + [int64]$script:Report.context_metrics.review_prompt_chars
        $script:Report.context_metrics["combined_prompt_chars"] = $promptChars
        $script:Report.context_metrics["combined_estimated_tokens_at_4_chars"] = [Math]::Ceiling($promptChars / 4.0)
        if ($baselineBytes -gt 0) {
            $script:Report.context_metrics["prompt_chars_vs_repository_bytes_percent"] = [Math]::Round(($promptChars / [double]$baselineBytes) * 100, 2)
        }
        Write-RunLog "Independent review approved the bounded, tested implementation."

        if ($DryRun) {
            $script:Report.status = "dry_run_passed"
            Write-RunLog "Dry run passed. GitHub publication was intentionally skipped and the clone was preserved."
            return
        }

        $branch = "daily/$date"
        $remoteBranch = Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "ls-remote", "--exit-code", "origin", "refs/heads/$branch") -AllowFailure
        if ($remoteBranch.ExitCode -eq 0) { throw "Remote daily branch already exists: $branch" }
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "switch", "-c", $branch) | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "config", "user.name", "everyday-mcp-local-bot") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "config", "user.email", "eladshilo112@users.noreply.github.com") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "add", "--", "CATALOG.md", $solutionRelative) | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--cached", "--check") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "commit", "-m", "daily: add solution $solutionId, $date") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "push", "--set-upstream", "origin", $branch) | Out-Null
        $script:PublicationState.branch = $branch
        $script:PublicationState.branch_owned = $true
        $prTitle = "Daily solution $solutionId, $date"
        $prBody = "Claude planned and reviewed this bounded solution. Codex implemented it in a disposable local clone. Graphify supplied targeted dependency context before and after implementation. Fixed validators compiled, tested, audited, and scanned the exact delta before publication. Required CI still gates squash auto-merge."
        $prUrl = (Invoke-Wsl -WslExe $wsl -Arguments @("gh", "pr", "create", "-R", [string]$config.repository, "--base", [string]$config.default_branch, "--head", $branch, "--title", $prTitle, "--body", $prBody)).Output.Trim()
        $script:PublicationState.pr_url = $prUrl
        Invoke-Wsl -WslExe $wsl -Arguments @("gh", "pr", "merge", "-R", [string]$config.repository, "--auto", "--squash", "--delete-branch", $prUrl) | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("gh", "pr", "checks", "-R", [string]$config.repository, "--watch", "--fail-fast", $prUrl) | Out-Null
        $merged = $false
        for ($attempt = 0; $attempt -lt 12; $attempt++) {
            $prState = (Invoke-Wsl -WslExe $wsl -Arguments @("gh", "pr", "view", "-R", [string]$config.repository, $prUrl, "--json", "state,mergedAt,url")).Output | ConvertFrom-Json
            if ([string]$prState.state -eq "MERGED" -and $null -ne $prState.mergedAt) {
                $merged = $true
                $script:Report["pull_request_url"] = [string]$prState.url
                $script:Report["merged_at"] = [string]$prState.mergedAt
                $script:PublicationState.merged = $true
                break
            }
            Start-Sleep -Seconds 5
        }
        if (-not $merged) { throw "CI passed but the pull request was not confirmed merged" }
        $script:Report.stages["github_publication"] = "merged"
        $script:Report.status = "published"
        Write-RunLog "The daily pull request passed CI and was confirmed merged."

        $resolvedRunRepo = [System.IO.Path]::GetFullPath($runRepo)
        $resolvedRunDir = [System.IO.Path]::GetFullPath($runDir) + [System.IO.Path]::DirectorySeparatorChar
        if ($resolvedRunRepo.StartsWith($resolvedRunDir, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedRunRepo) -eq "repo") {
            Remove-Item -LiteralPath $resolvedRunRepo -Recurse -Force
            $script:Report["disposable_clone_removed"] = $true
        }
    }
    finally {
        if ($null -ne $mutex) {
            try { $mutex.ReleaseMutex() } catch { }
            $mutex.Dispose()
        }
    }
}

if ($MyInvocation.InvocationName -eq '.') { return }

try {
    Main
    if ($script:Report.status -eq "starting") { $script:Report.status = "completed" }
    Save-Report
    exit 0
}
catch {
    $failureMessage = $_.Exception.Message
    $script:Report.status = "failed"
    $script:Report["error"] = $failureMessage
    try {
        $script:Report["publication_rollback"] = Undo-UnmergedPublication
    }
    catch {
        $script:Report["publication_rollback"] = "rollback_failed: $($_.Exception.Message)"
    }
    Write-RunLog ("FAILED: " + $failureMessage)
    Save-Report
    exit 1
}
