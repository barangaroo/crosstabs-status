# Agent instructions

<!-- ci-cost-rules:start (keep this block in sync across repos) -->
## GitHub Actions cost rules (every agent, every repo)

GitHub Actions minutes are billed. Every push to a PR branch and every merge to `main` starts CI, and one full run can cost an hour of runner time. Treat every push as spending money.

1. **Verify locally before pushing.** Run the relevant lint, typecheck and tests on your machine first. Never push just to see whether CI passes.
2. **Push once per task.** Batch your commits locally and push when the work is done. Don't push after each commit, and don't push a stream of small fixups to an open PR.
3. **One PR per task.** Don't split one task into many small PRs, and don't open a PR before the work is finished. Draft PRs run CI too.
4. **Skip CI when CI tests nothing that changed.** If a commit touches only docs, comments or agent instruction files, put `[skip ci]` in its message.
5. **Don't rerun blindly.** When CI fails, reproduce and fix it locally. Rerun only for a clear infrastructure flake, and at most once.
6. **Ask before adding cost.** Get the owner's approval before you add a workflow, add or change a trigger or `schedule`, widen a matrix, add jobs or shards, raise a timeout, or move to macOS, Windows or larger runners (macOS costs 10× Linux).
7. **Keep cancellation on.** CI that runs on `push` or `pull_request` needs a `concurrency` group with `cancel-in-progress: true`, so a new push cancels the outdated run.
<!-- ci-cost-rules:end -->
