---
name: Autonomous pilot task (control contract)
about: One low-risk engineering task; keep BLOCKED until infrastructure is verified
title: '[AUTO] '
---

The canonical Task ID is `BB-<this issue number>`. After creation, put that ID in `task_id`, add **exactly one** `autonomy:<STATE>` label, and keep it `autonomy:BLOCKED` until the external gates in `docs/engineering-control-plane.md` are verified. One Issue belongs to one task and at most one task PR.

<!-- AUTONOMY_TASK_V1 -->
```json
{
  "task_id": "BB-REPLACE_WITH_ISSUE_NUMBER",
  "scope": "Single bounded low-risk documentation/test pilot",
  "allowed_areas": ["docs/autonomy-pilot/"],
  "reserved_areas": ["docs/autonomy-pilot/"],
  "dependencies": [],
  "risk": {
    "classification": "low",
    "production": false,
    "supabase_rls": false,
    "vat": false,
    "invoice_truth": false,
    "bank_reconciliation": false,
    "payments": false,
    "destructive_migration": false,
    "secrets": false,
    "customer_data_deletion": false
  },
  "acceptance_criteria": ["Replace with observable result"],
  "required_gates": ["Replace with an exact GitHub check name"],
  "worker": {
    "id": "claude-worker-1",
    "github_login": "REPLACE_WITH_SEPARATE_CLAUDE_GITHUB_IDENTITY"
  }
}
```

Human-readable intent and Product Decision context:
