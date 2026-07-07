# Grupo Dines Chatwoot Customization

This branch carries the Grupo Dines customization on top of upstream Chatwoot.

## Custom behavior

- Adds a third account role: `supervisor`.
- Administrators and supervisors can access every conversation in the account.
- Normal agents can access only conversations assigned to them or conversations where they are participants.
- Search, macros, uploads, realtime recipients, unread counts, and enterprise conversation paths are scoped with the same rule.

## Repository layout

Current local remotes:

```bash
origin    https://github.com/DinesHolding/chatwoot.git
local-backup  ../chatwoot-custom.git
upstream  https://github.com/chatwoot/chatwoot.git
```

`origin` is the DinesHolding repository. `local-backup` is a bare repository in the parent folder, kept only as a local fallback.

If `origin` ever needs to be restored manually, use:

```bash
git remote set-url origin https://github.com/DinesHolding/chatwoot.git
git push -u origin gd-supervisor-conversation-scope
git push origin prod/chatwoot-supervisor-20260707171100
```

Expected long-term remotes:

```bash
origin    private Grupo Dines fork/custom repo
upstream  https://github.com/chatwoot/chatwoot.git
```

The local branch to keep alive is:

```bash
gd-supervisor-conversation-scope
```

## Updating to a new Chatwoot release

Use the helper script from the repository root:

```powershell
.\script\custom\merge-upstream-release.ps1 -TargetTag v4.16.0
```

If the merge has conflicts, resolve them, then run:

```bash
git add <resolved-files>
git commit
```

Recommended checks after every merge:

```bash
git diff --check
corepack pnpm exec vitest --run --no-coverage app/javascript/dashboard/store/modules/conversations/specs/helpers.spec.js app/javascript/dashboard/helper/specs/permissionsHelper.spec.js app/javascript/dashboard/helper/specs/routeHelpers.spec.js
```

If Ruby/Bundler is available, also run:

```bash
bundle exec rspec spec/services/conversations/permission_filter_service_spec.rb spec/enterprise/services/enterprise/conversations/permission_filter_service_spec.rb spec/policies/conversation_policy_spec.rb spec/finders/conversation_finder_spec.rb spec/services/search_service_spec.rb spec/services/conversations/unread_counts/counter_spec.rb
```

## Deployment notes

Production currently runs a custom image derived from Chatwoot 4.15.1 with this branch applied.

For the next release:

1. Merge the upstream tag with `merge-upstream-release.ps1`.
2. Run the focused checks above.
3. Build a new Docker image with a unique tag, for example:

   ```bash
   docker build -f docker/Dockerfile -t easypanel/apps/chatwoot-supervisor:<yyyymmddHHMMSS> .
   ```

4. Update both EasyPanel/Swarm services:

   ```bash
   docker service update --no-resolve-image --image easypanel/apps/chatwoot-supervisor:<tag> chatwoot_chatwoot
   docker service update --no-resolve-image --image easypanel/apps/chatwoot-supervisor:<tag> chatwoot_chatwoot-sidekiq
   ```

5. Verify:

   ```bash
   docker service ls --format '{{.Name}} {{.Replicas}} {{.Image}}' | grep chatwoot
   curl -fsS https://crm.grupodines.com/api
   ```
