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
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
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
    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') { return $Argument }
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
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $null -ne $InputText
    $startInfo.Arguments = (($Arguments | ForEach-Object { Convert-ToWindowsCommandLineArgument -Argument ([string]$_) }) -join ' ')
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    try {
        $startInfo.StandardOutputEncoding = $utf8
        $startInfo.StandardErrorEncoding = $utf8
    }
    catch { }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Could not start process: $FilePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($null -ne $InputText) {
        $process.StandardInput.Write($InputText)
        $process.StandardInput.Close()
    }
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
    $branch = [string]$script:PublicationState.branch
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
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
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
        $catalog = Get-Content -LiteralPath (Join-Path $runRepo "CATALOG.md") -Raw
        $policy = Get-Content -LiteralPath (Join-Path $runRepo ".automation\content-policy.json") -Raw
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
        $planSchema = (Get-Content -LiteralPath $planSchemaPath -Raw | ConvertFrom-Json) | ConvertTo-Json -Depth 20 -Compress
        $planSystemPrompt = "You are a constrained public open-source MCP planner. Follow the supplied task and return only the required structured JSON. Do not use tools or infer private context."
        $claudePlan = Invoke-Captured -FilePath $claude -Arguments @("-p", "--safe-mode", "--system-prompt", $planSystemPrompt, "--permission-mode", "plan", "--model", "sonnet", "--effort", "medium", "--output-format", "json", "--max-turns", "2", "--no-session-persistence", "--json-schema", $planSchema, "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task") -WorkingDirectory $runRepo -InputText $planPrompt -StdoutPath (Join-Path $runDir "claude-plan.output.json") -StderrPath (Join-Path $runDir "claude-plan.stderr")
        $planResult = Get-ClaudeStructuredOutput -JsonText $claudePlan.Output
        $plan = $planResult.Value
        Assert-PlanIdentity -Plan $plan -ExpectedId $solutionId -ExpectedDate $date
        $planJson = $plan | ConvertTo-Json -Depth 20
        $planPath = Join-Path $runDir "validated-plan.json"
        Write-Utf8NoBom -Path $planPath -Text $planJson
        $wslPlanPath = Convert-ToWslPath -WslExe $wsl -WindowsPath $planPath
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_topic_policy.py", $wslPlanPath, "--category", [string]$plan.category) | Out-Null
        if ($null -ne $planResult.Envelope.usage) { $script:Report["claude_plan_usage"] = $planResult.Envelope.usage }
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
        $codexResult = Get-Content -LiteralPath $codexResultPath -Raw | ConvertFrom-Json
        if ([string]$codexResult.solution_id -ne $solutionId -or [string]$codexResult.slug -ne [string]$plan.slug) { throw "Codex result identity does not match the validated plan" }
        $headAfterCodex = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "rev-parse", "HEAD")).Output.Trim()
        if ($headAfterCodex -ne $baseHead) { throw "Codex created a commit, which is outside its authorization" }
        $script:Report.stages["codex_implementation"] = "completed"
        Write-RunLog "Codex implementation completed inside the disposable clone."

        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_daily_delta.py", "--root", $wslRepo, "--expected-id", $solutionId, "--expected-slug", [string]$plan.slug) -StdoutPath (Join-Path $runDir "delta-before.stdout") -StderrPath (Join-Path $runDir "delta-before.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_solution.py", "$wslRepo/$solutionRelative", "--install", "--audit") -StdoutPath (Join-Path $runDir "solution-validation.stdout") -StderrPath (Join-Path $runDir "solution-validation.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_daily_delta.py", "--root", $wslRepo, "--expected-id", $solutionId, "--expected-slug", [string]$plan.slug) -StdoutPath (Join-Path $runDir "delta-after.stdout") -StderrPath (Join-Path $runDir "delta-after.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/scan_secrets.py", "$wslRepo/$solutionRelative") -StdoutPath (Join-Path $runDir "secret-scan.stdout") -StderrPath (Join-Path $runDir "secret-scan.stderr") | Out-Null
        Invoke-Wsl -WslExe $wsl -Arguments @("python3", "$wslRepo/scripts/validate_topic_policy.py", "$wslRepo/$solutionRelative", "--category", [string]$plan.category) -StdoutPath (Join-Path $runDir "topic-policy.stdout") -StderrPath (Join-Path $runDir "topic-policy.stderr") | Out-Null
        $script:Report.stages["deterministic_validation"] = "passed"
        Write-RunLog "Fixed build, MCP integration, audit, secret, delta, and topic gates passed."

        Invoke-Captured -FilePath $graphify -Arguments @("update", ".", "--no-cluster") -WorkingDirectory $runRepo -StdoutPath (Join-Path $runDir "graphify-after.stdout") -StderrPath (Join-Path $runDir "graphify-after.stderr") | Out-Null
        $reviewGraph = Invoke-GraphQuery -GraphifyExe $graphify -Repository $runRepo -Question "Review the impact of $solutionRelative. Identify only boundary violations, unsafe relationships, validator gaps, duplicated purpose, and catalog inconsistencies relevant to approval." -Budget $graphBudget -EvidencePath (Join-Path $runDir "graphify-review.txt")
        $diffStat = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--stat", "--", "CATALOG.md", $solutionRelative)).Output
        $diffExcerptRaw = (Invoke-Wsl -WslExe $wsl -Arguments @("git", "-C", $wslRepo, "diff", "--no-ext-diff", "--unified=1", "--", "CATALOG.md", $solutionRelative)).Output
        $diffExcerpt = Limit-Context -Text $diffExcerptRaw -MaximumCharacters 18000
        $reviewPrompt = @"
Act as the final read-only reviewer. Approve only if the validated plan was implemented, the public topic boundary is respected, the MCP is genuinely useful, and the deterministic evidence is sufficient.
Use the targeted Graphify impact context and bounded diff excerpt. Do not use tools or edit files.
The fixed gates already passed: delta boundary, dependency allowlist, TypeScript compilation, all tests including stdio integration, npm high-severity audit, secret scan, topic scan, and catalog validation.
Return only the JSON required by the supplied review schema. Reject with concise material findings if any blocking issue remains.

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
        $reviewSchema = (Get-Content -LiteralPath $reviewSchemaPath -Raw | ConvertFrom-Json) | ConvertTo-Json -Depth 20 -Compress
        $reviewSystemPrompt = "You are a constrained public open-source code reviewer. Judge only the supplied evidence and return only the required structured JSON. Do not use tools or infer private context."
        $claudeReview = Invoke-Captured -FilePath $claude -Arguments @("-p", "--safe-mode", "--system-prompt", $reviewSystemPrompt, "--permission-mode", "plan", "--model", "sonnet", "--effort", "medium", "--output-format", "json", "--max-turns", "2", "--no-session-persistence", "--json-schema", $reviewSchema, "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task") -WorkingDirectory $runRepo -InputText $reviewPrompt -StdoutPath (Join-Path $runDir "claude-review.output.json") -StderrPath (Join-Path $runDir "claude-review.stderr")
        $reviewResult = Get-ClaudeStructuredOutput -JsonText $claudeReview.Output
        $review = $reviewResult.Value
        if ([string]$review.verdict -ne "approve" -or -not $review.policy_ok -or -not $review.tests_ok -or @($review.material_findings).Count -ne 0) {
            throw "Claude review rejected the generated solution"
        }
        if ($null -ne $reviewResult.Envelope.usage) { $script:Report["claude_review_usage"] = $reviewResult.Envelope.usage }
        $script:Report.stages["claude_review"] = "approved"
        $promptChars = [int64]$script:Report.context_metrics.plan_prompt_chars + [int64]$script:Report.context_metrics.implementation_prompt_chars + [int64]$script:Report.context_metrics.review_prompt_chars
        $script:Report.context_metrics["combined_prompt_chars"] = $promptChars
        $script:Report.context_metrics["combined_estimated_tokens_at_4_chars"] = [Math]::Ceiling($promptChars / 4.0)
        if ($baselineBytes -gt 0) {
            $script:Report.context_metrics["prompt_chars_vs_repository_bytes_percent"] = [Math]::Round(($promptChars / [double]$baselineBytes) * 100, 2)
        }
        Write-RunLog "Claude review approved the bounded, tested implementation."

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
