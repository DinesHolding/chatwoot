param(
  [Parameter(Mandatory = $true)]
  [string]$TargetTag,

  [string]$CustomBranch = "gd-supervisor-conversation-scope"
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw "Run this script inside the Chatwoot repository."
}

Set-Location $repoRoot

$dirty = (& git status --porcelain)
if ($dirty) {
  throw "Working tree is not clean. Commit or stash local changes before merging an upstream release."
}

$upstreamUrl = (& git remote get-url upstream 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $upstreamUrl) {
  throw "Missing upstream remote. Expected: git remote add upstream https://github.com/chatwoot/chatwoot.git"
}

Invoke-Git fetch upstream --tags
Invoke-Git rev-parse --verify "$TargetTag^{commit}"
Invoke-Git checkout $CustomBranch

Write-Host "Merging upstream Chatwoot release $TargetTag into $CustomBranch"
& git merge --no-ff $TargetTag -m "Merge Chatwoot $TargetTag into supervisor customization"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Merge stopped with conflicts. Resolve them, then run:"
  Write-Host "  git add <resolved-files>"
  Write-Host "  git commit"
  exit $LASTEXITCODE
}

Invoke-Git diff --check

Write-Host ""
Write-Host "Merge complete. Recommended next checks:"
Write-Host "  corepack pnpm exec vitest --run --no-coverage app/javascript/dashboard/store/modules/conversations/specs/helpers.spec.js app/javascript/dashboard/helper/specs/permissionsHelper.spec.js app/javascript/dashboard/helper/specs/routeHelpers.spec.js"
Write-Host "  bundle exec rspec spec/services/conversations/permission_filter_service_spec.rb spec/enterprise/services/enterprise/conversations/permission_filter_service_spec.rb spec/policies/conversation_policy_spec.rb spec/finders/conversation_finder_spec.rb spec/services/search_service_spec.rb spec/services/conversations/unread_counts/counter_spec.rb"

