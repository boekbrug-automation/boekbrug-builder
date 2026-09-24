# Engineering control plane — Phase 1

This contract is for a future, low-risk pilot. It does **not** start Claude workers, change BoekBrug features, mutate task labels, merge PRs, or deploy anything. The existing numbered engineering lanes and roadmap continue independently. PRs #384, #385 and #386 are read-only shadow cases, never enrolled tasks.

## Canonical records

Each task is exactly one GitHub Issue. Its ID is computed from GitHub's issue number (`BB-123` = issue #123); it cannot be chosen by a worker. Use the Issue template in `.github/ISSUE_TEMPLATE/autonomy-task.md`. The single `AUTONOMY_TASK_V1` JSON block supplies scope, allowed files, exclusive reservations, dependency IDs, risk/impact booleans, observable acceptance criteria, exact required check names, and a persistent worker ID plus authenticated GitHub login. Apply **exactly one** `autonomy:<STATE>` Issue label. Until the prerequisites below are verified, use `autonomy:BLOCKED`, and do not queue a worker.

The assigned worker owns one branch `claude/task-bb-123` and one isolated worktree `../boekbrug-worker-bb-123`; a task has at most one open PR. One worker cannot hold two active tasks, even if their paths do not overlap. A worker changing tasks gets a new branch and worktree. Reserve paths before starting and compare against all active reservations, including work awaiting review and verified but not merged. A dependency must be both VERIFIED and merged before claim. A shared file, especially `.github/`, `AGENTS.md`, `CLAUDE.md`, package manifests, `supabase/` and `src/lib/lifecycle-gates.test.ts`, requires manual coordination. The initial pilot only permits `docs/autonomy-pilot/` and `tests/autonomy-pilot/` and explicit low risk with **all** impact flags false. Paths outside the declared allowlist refuse submission and review.

| From | Event and conditions | To |
| --- | --- | --- |
| READY | Assigned worker claims; prerequisites, merged dependencies, reservations and low-risk gate pass | BUILDING |
| BUILDING | Open task PR; current head/base, exact changed files, handoff and head-specific checks pass | REVIEW_REQUIRED |
| REVIEW_REQUIRED | Authenticated separate reviewer submits `FAIL` with concrete findings for the current head/base | FIX_REQUIRED, same worker |
| FIX_REQUIRED | The same assigned worker resumes | BUILDING |
| REVIEW_REQUIRED | Separate reviewer submits `PASS`, no unresolved items, fresh scope/checks/head/base | VERIFIED |
| REVIEW_REQUIRED or VERIFIED | A push changes the head or a relevant base changes | BUILDING; previous PASS is stale |
| Any | Reasoned block | BLOCKED |
| BLOCKED | Operator resolves block and dependencies are still valid | READY |

The state function in `scripts/autonomy/contract.mjs` checks these transitions without writing to GitHub. It does **not** currently consume GitHub webhooks or update Issue labels. A future dispatcher must reread the Issue, PR, diff, checks and live `main` SHA immediately before each transition and serialize label changes per task and reservation. GitHub metadata writes and Claude requeueing must stay disabled until the prerequisites below are met. Existing approvals after a push remain visible in GitHub but must never count as a new PASS. The reviewer login must differ from the Builder's authenticated GitHub login; a name in prose or a bot attribution in a comment does not provide separation.

## Handoff and review payloads

The Builder places one JSON block in its task PR description, followed by human-readable evidence. `changed_scope` lists actual GitHub diff filenames, not broad path claims. `base_sha` is the exact `main` SHA used for the review and `head_sha` is the exact PR commit. All SHA values are complete 40-character IDs. The issue's required checks must be green **on this head**.

<!-- AUTONOMY_HANDOFF_V1 -->
```json
{
  "task_id": "BB-123",
  "base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "changed_scope": ["docs/autonomy-pilot/example.md"],
  "evidence": ["Exact test/check result and why it proves acceptance"],
  "risks": [],
  "impact": { "migrations": "none", "data": "none", "security": "none" },
  "unresolved_items": []
}
```

An independent reviewer uses a **GitHub PR review**, not an Issue comment, with GitHub review state `APPROVED` for PASS or `CHANGES_REQUESTED` for FAIL. The authenticated reviewer, `review.commit_id`, PR head, handoff and current base must agree. Findings must state what was checked or what failed; FAIL findings feed the same worker's fix loop.

<!-- AUTONOMY_REVIEW_V1 -->
```json
{
  "task_id": "BB-123",
  "verdict": "PASS",
  "reviewed_head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "reviewer_login": "INDEPENDENT_AUTHENTICATED_GITHUB_ACCOUNT",
  "findings": ["Evidence supports criterion X at the specified commit"]
}
```

The JSON samples above are examples only, never live records. Issue labels are the planned task state source; the GitHub PR review event is the planned verdict source. No PASS is inferred from a successful check or a prose handoff.

## Observed prerequisites and blockers (24 September 2026 UTC)

| Item | Observed | Must be true before automated code writes |
| --- | --- | --- |
| `main` CI | First run #1235 on `49a7c131` failed the Next/Turbopack `next/font/google` build with missing `@vercel/turbopack-next/internal/font/google/font`; rerun of **the same SHA**, attempt 2, succeeded. This demonstrates an intermittent baseline discrepancy, not its root cause. The PR build successes alone did not explain it. | Diagnose reproducibility and give the branch required checks a stable green baseline. Do not change product code under this phase. |
| GitHub protection | Branch API reports `main.protected = false`; rulesets listing is empty. Protection detail endpoint is inaccessible to the present integration (403). Existing CI checks run but are not enforced merge requirements. | Admin configures protection/ruleset, required CI and separate human review, prevents bypass/force push and bot auto-merge; verify with readback. |
| Vercel Production Branch | The project settings URL requires account login; only PR preview statuses are visible. Actual Production Branch and automatic merge-triggered promotion remain **unverified**. | Inspect project settings with authorized account, establish production-only human approval and verify that a merge to `main` cannot automatically deploy before a pilot. |
| Claude execution | Existing PRs show Claude cloud session links; local `claude` CLI and `ANTHROPIC_API_KEY` are absent, and there is no worker-execution workflow or configured worker identity here. | Establish supported Claude execution, scoped credentials, event routing, isolated worktrees, one-worker-per-task assignment, retries and stop controls. Test it without product mutations. |
| Independent reviewer | Current PRs are authored by GitHub `mofwim`; the available ChatGPT GitHub connector also authenticates as `mofwim`. No separate reviewer GitHub principal or event trigger is confirmed. | Provision independent reviewer principal with minimum review permission and a reliable ChatGPT invocation path; confirm it can record GitHub `APPROVED`/`CHANGES_REQUESTED` with a bound SHA. The same GitHub login cannot attest independence. |
| Issue queue and arbitration | No existing autonomy Issues/labels, metadata dispatcher or atomic reservation broker. This phase provides only the parser/state contract. | Create the six labels and a controlled dispatcher with serialized Issue/reservation updates and live-diff rechecks; dry-run before enabling writes. |

Existing `.github/workflows/ci.yml`, `AGENTS.md`, `CLAUDE.md`, Next tests, GitHub PR descriptions/reviews and preview checks can be reused. The new read-only workflow tests the control contract on its own PR; only a manual `workflow_dispatch` after the workflow reaches the default branch can collect shadow packets for the three named PRs. The packet contains the PR body, diff file patches, checks and existing reviews, but sets `verdict: null`. If patches are absent or truncated, the packet says so; it cannot justify a PASS. A PR whose head/base changes during collection is rejected. This workflow has no write permission and never posts to an existing feature PR.

## Release boundary

Autonomous Production, Supabase/RLS, BTW, invoice truth, bank reconciliation, payments, destructive migrations, secrets and customer-data deletion are excluded from the initial pilot. Product/financial/security decisions remain human-led. No autonomous merge, production deploy or high-risk task claim is authorized by this document. GitHub branch protection and production deployment controls must enforce the boundary independently of any JavaScript checks.

## Small next activation sequence

1. Verify GitHub protection and Vercel Production Branch with authorized settings access; finish diagnosing the intermittent `main` build. Obtain distinct Builder/Reviewer principals and a supported execution trigger. Keep task queue blocked.
2. Connect event ingestion to this contract in dry-run mode; establish serial reservation and exact head/base/check readback. Test a stale push and a base change against GitHub events, with no Issue label writes.
3. Enable label transitions and the same-worker FAIL routing **only for two or three independent low-risk pilot Issues** under the two allowlisted directories, after an operator checks the external gates. Keep merge and deployment manual. Expand scope only after actual event and review evidence supports it.
