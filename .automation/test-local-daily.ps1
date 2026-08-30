[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$runner = Join-Path $PSScriptRoot "local-daily.ps1"
. $runner

$testRoot = Join-Path $env:TEMP ("everyday-mcp-local-daily-test-" + [Guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $stdinReader = Join-Path $testRoot "read-stdin-bytes.ps1"
    Write-Utf8NoBom -Path $stdinReader -Text @'
$memory = New-Object System.IO.MemoryStream
$inputStream = [Console]::OpenStandardInput()
$inputStream.CopyTo($memory)
[Console]::Write([Convert]::ToBase64String($memory.ToArray()))
'@

    $hebrewText = -join @(0x05E2, 0x05D1, 0x05E8, 0x05D9, 0x05EA, 0x0020, 0x05EA, 0x05E7, 0x05D9, 0x05E0, 0x05D4 | ForEach-Object { [char]$_ })
    $rocket = [char]::ConvertFromUtf32(0x1F680)
    $inputText = "$hebrewText $rocket`nUTF-8 line two"
    $powershell = (Get-Process -Id $PID).Path
    $captured = Invoke-Captured -FilePath $powershell -Arguments @(
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $stdinReader
    ) -WorkingDirectory $testRoot -InputText $inputText
    $expectedBytes = ([Text.UTF8Encoding]::new($false)).GetBytes($inputText)
    $expectedBase64 = [Convert]::ToBase64String($expectedBytes)
    if ($captured.Output -ne $expectedBase64) {
        $actualBytes = [Convert]::FromBase64String($captured.Output)
        throw "Invoke-Captured did not send exact UTF-8 bytes: expected=$($expectedBytes.Length), actual=$($actualBytes.Length), expected_b64=$expectedBase64, actual_b64=$($captured.Output)"
    }

    $quotaEnvelope = [ordered]@{
        is_error = $true
        result = "You've hit your monthly spend limit"
    } | ConvertTo-Json -Compress
    $quotaMessage = Get-ClaudeFailureMessage -JsonText $quotaEnvelope
    if (-not (Test-ClaudeMonthlySpendLimit -Message $quotaMessage)) {
        throw "Claude monthly spend limit was not recognized"
    }
    if (Test-ClaudeMonthlySpendLimit -Message "ordinary transient failure") {
        throw "An unrelated Claude failure was classified as a spend limit"
    }
    if ((Get-ClaudeFallbackReason -Message $quotaMessage) -ne "CLAUDE_MONTHLY_SPEND_LIMIT") {
        throw "Claude spend-limit fallback reason is incorrect"
    }
    $expiredOauth = "Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue."
    if ((Get-ClaudeFallbackReason -Message $expiredOauth) -ne "CLAUDE_OAUTH_EXPIRED") {
        throw "Claude expired OAuth was not recognized"
    }
    if ($null -ne (Get-ClaudeFallbackReason -Message "ordinary transient failure")) {
        throw "An unrelated Claude failure was allowed to fall back"
    }

    $codexPlanSchema = Join-Path $testRoot "codex-plan.schema.json"
    Write-CodexCompatiblePlanSchema -SourcePath (Join-Path $PSScriptRoot "local-plan.schema.json") -DestinationPath $codexPlanSchema
    $schemaObject = Get-Content -LiteralPath $codexPlanSchema -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($schemaObject.properties.tool_names.PSObject.Properties.Name -contains "uniqueItems") {
        throw "Codex-compatible plan schema still contains uniqueItems"
    }
    if ($schemaObject.required.Count -ne 14 -or $schemaObject.properties.tool_names.type -ne "array") {
        throw "Codex-compatible plan schema changed the closed structure"
    }

    $reviewCases = @(
        [pscustomobject]@{ Name = "approve_empty"; Review = [pscustomobject]@{ verdict = "approve"; policy_ok = $true; tests_ok = $true; material_findings = @() }; Pass = $true; Reason = "approved" },
        [pscustomobject]@{ Name = "approve_with_findings"; Review = [pscustomobject]@{ verdict = "approve"; policy_ok = $true; tests_ok = $true; material_findings = @("minor note") }; Pass = $false; Reason = "approve_with_material_findings_inconsistent" },
        [pscustomobject]@{ Name = "reject"; Review = [pscustomobject]@{ verdict = "reject"; policy_ok = $true; tests_ok = $true; material_findings = @("blocking issue") }; Pass = $false; Reason = "verdict_not_approve" },
        [pscustomobject]@{ Name = "policy_failed"; Review = [pscustomobject]@{ verdict = "approve"; policy_ok = $false; tests_ok = $true; material_findings = @() }; Pass = $false; Reason = "policy_failed" },
        [pscustomobject]@{ Name = "tests_failed"; Review = [pscustomobject]@{ verdict = "approve"; policy_ok = $true; tests_ok = $false; material_findings = @() }; Pass = $false; Reason = "tests_failed" },
        [pscustomobject]@{ Name = "policy_string_false"; Review = [pscustomobject]@{ verdict = "approve"; policy_ok = "false"; tests_ok = $true; material_findings = @() }; Pass = $false; Reason = "policy_type_invalid" },
        [pscustomobject]@{ Name = "tests_string_false"; Review = [pscustomobject]@{ verdict = "approve"; policy_ok = $true; tests_ok = "false"; material_findings = @() }; Pass = $false; Reason = "tests_type_invalid" },
        [pscustomobject]@{ Name = "verdict_number"; Review = [pscustomobject]@{ verdict = 1; policy_ok = $true; tests_ok = $true; material_findings = @() }; Pass = $false; Reason = "verdict_type_invalid" }
    )
    foreach ($case in $reviewCases) {
        $decision = Get-ReviewDecision -Review $case.Review
        if ([bool]$decision.Pass -ne [bool]$case.Pass -or [string]$decision.Reason -ne [string]$case.Reason) {
            throw "Review decision case failed: $($case.Name), pass=$($decision.Pass), reason=$($decision.Reason)"
        }
    }

    $inconsistentReview = [pscustomobject]@{
        verdict = "approve"
        summary = "Approved with a non-blocking dependency curiosity."
        policy_ok = $true
        tests_ok = $true
        material_findings = @("dependency version looks unusual but validation passed")
    }
    $reclassificationPrompt = New-ReviewReclassificationPrompt -Review $inconsistentReview
    if ($reclassificationPrompt -notmatch [regex]::Escape("Do not perform a new review") -or
        $reclassificationPrompt -notmatch [regex]::Escape("approve requires an empty material_findings array") -or
        $reclassificationPrompt -notmatch [regex]::Escape("dependency version looks unusual but validation passed")) {
        throw "Review reclassification prompt did not preserve the bounded classification-only contract"
    }

    $reviewSchemaObject = Get-Content -LiteralPath (Join-Path $PSScriptRoot "local-review.schema.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$reviewSchemaObject.properties.material_findings.description -notmatch "Blocking issues only" -or
        [string]$reviewSchemaObject.properties.verdict.description -notmatch "material_findings is empty") {
        throw "Review schema does not document the fail-closed consistency invariant"
    }

    $fakeClaude = Join-Path $testRoot "fake-claude.cmd"
    Write-Utf8NoBom -Path $fakeClaude -Text @'
@echo off
echo {"is_error":true,"result":"You've hit your monthly spend limit"}
exit /b 1
'@
    $fakeCodex = Join-Path $testRoot "fake-codex.cmd"
    Write-Utf8NoBom -Path $fakeCodex -Text @'
@echo off
set "RESULT_PATH="
:scan
if "%~1"=="" goto missing
if /I "%~1"=="--output-last-message" (
  set "RESULT_PATH=%~2"
  goto write
)
shift
goto scan
:write
> "%RESULT_PATH%" echo {"verdict":"approve","summary":"Synthetic isolated fallback review passed.","policy_ok":true,"tests_ok":true,"material_findings":[]}
exit /b 0
:missing
exit /b 2
'@
    $fallbackResult = Invoke-ClaudeStructuredWithCodexFallback -Stage "synthetic-review" -Claude $fakeClaude -ClaudeArguments @("--synthetic") -Codex $fakeCodex -Prompt "Synthetic public review prompt" -FallbackSystemPrompt "Return the closed review object" -SchemaPath (Join-Path $PSScriptRoot "local-review.schema.json") -WorkingDirectory $testRoot -ClaudeStdoutPath (Join-Path $testRoot "fake-claude.stdout") -ClaudeStderrPath (Join-Path $testRoot "fake-claude.stderr") -CodexResultPath (Join-Path $testRoot "fake-codex.result.json") -CodexStdoutPath (Join-Path $testRoot "fake-codex.stdout") -CodexStderrPath (Join-Path $testRoot "fake-codex.stderr") -FallbackEnabled $true
    if ($fallbackResult.Backend -ne "codex_availability_fallback" -or $fallbackResult.ClaudeFailure -ne "CLAUDE_MONTHLY_SPEND_LIMIT" -or $fallbackResult.Value.verdict -ne "approve") {
        throw "Synthetic Claude-to-Codex fallback did not preserve the closed result"
    }

    $codexLimitMessage = Get-CodexFailureMessage -ErrorText "warning line`nERROR: You've hit your usage limit. Try tomorrow."
    if ($codexLimitMessage -notmatch '^ERROR: You''ve hit your usage limit') {
        throw "Codex usage-limit error was not selected over warnings"
    }

    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "local-runner.config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not [bool]$config.fallbacks.codex_on_claude_known_unavailability) {
        throw "Codex quota fallback is not explicitly enabled"
    }
    if ($config.review.reclassify_inconsistent_approve_once -isnot [bool] -or -not $config.review.reclassify_inconsistent_approve_once) {
        throw "The single review reclassification retry is not explicitly enabled"
    }

    [pscustomobject]@{
        ok = $true
        utf8_exact = $true
        quota_detection = $true
        oauth_expiry_detection = $true
        codex_schema_compatibility = $true
        review_decision_gate = $true
        review_reclassification_prompt = $true
        review_schema_invariant = $true
        synthetic_fallback = $true
        codex_error_selection = $true
        fallback_enabled = $true
        review_reclassification_enabled = $true
        test_root = $testRoot
    }
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
