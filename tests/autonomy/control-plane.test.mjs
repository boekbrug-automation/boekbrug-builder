import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES, TASK_MARKER, HANDOFF_MARKER, REVIEW_MARKER,
  branchFor, worktreeFor, taskFromIssue, handoffFromPr,
  reviewFromGitHub, transition,
} from '../../scripts/autonomy/contract.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const NEXT = 'c'.repeat(40);
const FILE = 'docs/autonomy-pilot/first.md';
const block = (marker, data) => `<!-- ${marker} -->\n\x60\x60\x60json\n${JSON.stringify(data)}\n\x60\x60\x60`;
const risk = () => ({
  classification: 'low', production: false, supabase_rls: false, vat: false,
  invoice_truth: false, bank_reconciliation: false, payments: false,
  destructive_migration: false, secrets: false, customer_data_deletion: false,
});
const issue = (patch = {}, labels = ['autonomy:READY']) => ({
  number: 1001, labels,
  body: block(TASK_MARKER, {
    task_id: 'BB-1001', scope: 'Write a pilot guide',
    allowed_areas: ['docs/autonomy-pilot/'], reserved_areas: ['docs/autonomy-pilot/'],
    dependencies: [], acceptance_criteria: ['Guide exists'],
    required_gates: ['control-plane-tests'],
    worker: { id: 'claude-worker-1', github_login: 'claude-builder' },
    risk: risk(), ...patch,
  }),
});
const task = (state = 'READY', patch = {}) => ({ ...taskFromIssue(issue(patch)), state });
const handoff = (patch = {}) => ({
  task_id: 'BB-1001', base_sha: BASE, head_sha: HEAD,
  changed_scope: [FILE], evidence: ['control-plane-tests succeeded at head'],
  risks: [], impact: { migrations: 'none', data: 'none', security: 'none' },
  unresolved_items: [], ...patch,
});
const pr = (patch = {}, info = handoff()) => ({
  state: 'open', body: block(HANDOFF_MARKER, info), head: { ref: branchFor('BB-1001'), sha: HEAD, repo: { full_name: 'mofwim/boekbrug' } },
  base: { ref: 'main', sha: BASE }, user: { login: 'claude-builder' }, ...patch,
});
const review = (verdict, patch = {}, payloadPatch = {}) => ({
  state: verdict === 'PASS' ? 'APPROVED' : 'CHANGES_REQUESTED',
  user: { login: 'chatgpt-reviewer' }, commit_id: HEAD,
  body: block(REVIEW_MARKER, {
    verdict, task_id: 'BB-1001', reviewed_head_sha: HEAD, base_sha: BASE,
    reviewer_login: 'chatgpt-reviewer', findings: [verdict === 'PASS' ? 'Evidence matches scope' : 'Guide omits step 2'],
    ...payloadPatch,
  }), ...patch,
});
const context = (patch = {}) => ({
  mainSha: BASE, changedFiles: [FILE], reviewerLogin: 'chatgpt-reviewer',
  gates: { 'control-plane-tests': { conclusion: 'success', head_sha: HEAD } },
  dependencies: {}, activeTasks: [], infrastructureReady: true, ...patch,
});

test('one issue is the task ID; all six states are labels; invalid or ambiguous labels fail', () => {
  assert.equal(task().id, 'BB-1001');
  assert.deepEqual(STATES, ['READY', 'BUILDING', 'REVIEW_REQUIRED', 'FIX_REQUIRED', 'VERIFIED', 'BLOCKED']);
  assert.throws(() => taskFromIssue(issue({}, ['autonomy:READY', 'autonomy:BUILDING'])), /exactly one/);
  assert.throws(() => taskFromIssue(issue({ task_id: 'BB-9' })), /must be BB-1001/);
  assert.throws(() => taskFromIssue(issue({ risk: { ...risk(), vat: undefined } })), /risk.vat/);
  assert.throws(() => taskFromIssue({ ...issue(), number: 1001, pull_request: {} }), /one GitHub Issue/);
});

test('claim requires assigned worker, nonconflicting reservation, merged deps and infrastructure gate', () => {
  const ready = task('READY', { dependencies: ['BB-1000'] });
  const deps = { 'BB-1000': { state: 'VERIFIED', merged: true } };
  assert.throws(() => transition(ready, { kind: 'claim', workerId: 'other' }, context({ dependencies: deps })), /assigned worker/);
  assert.throws(() => transition(ready, { kind: 'claim', workerId: ready.worker.id }, context({ dependencies: deps, infrastructureReady: false })), /infrastructure gate/);
  assert.throws(() => transition(ready, { kind: 'claim', workerId: ready.worker.id }, context({ dependencies: deps, activeTasks: undefined })), /live reservations/);
  assert.throws(() => transition(ready, { kind: 'claim', workerId: ready.worker.id }, context()), /dependency/);
  assert.throws(() => transition(ready, { kind: 'claim', workerId: ready.worker.id }, context({ dependencies: deps, activeTasks: [{ id: 'BB-2', state: 'FIX_REQUIRED', reserved_areas: ['docs/autonomy-pilot/first.md'] }] })), /reserved by BB-2/);
  assert.equal(transition(ready, { kind: 'claim', workerId: ready.worker.id }, context({ dependencies: deps })).state, 'BUILDING');
  assert.equal(branchFor(ready.id), 'claude/task-bb-1001');
  assert.equal(worktreeFor(ready.id), '../boekbrug-worker-bb-1001');
});

test('BUILDING -> REVIEW_REQUIRED -> VERIFIED requires GitHub diff, handoff, SHA-bound gate and independent approval', () => {
  const building = task('BUILDING');
  assert.equal(handoffFromPr(pr()).head_sha, HEAD);
  const submitted = transition(building, { kind: 'submit', pr: pr() }, context());
  assert.equal(submitted.state, 'REVIEW_REQUIRED');
  assert.equal(reviewFromGitHub(review('PASS')).reviewerLogin, 'chatgpt-reviewer');
  const passed = transition({ ...building, state: submitted.state }, { kind: 'review', pr: pr(), review: review('PASS') }, context());
  assert.equal(passed.state, 'VERIFIED');
  assert.equal(passed.workerId, building.worker.id);
  assert.throws(() => transition(building, { kind: 'submit', pr: pr({ user: { login: 'somebody' } }) }, context()), /assigned worker/);
  assert.throws(() => transition(building, { kind: 'submit', pr: pr() }, context({ changedFiles: ['src/lib/payments.ts'] })), /changed scope/);
  assert.throws(() => transition(building, { kind: 'submit', pr: pr() }, context({ gates: { 'control-plane-tests': { conclusion: 'success', head_sha: NEXT } } })), /this head/);
  assert.throws(() => transition(building, { kind: 'submit', pr: pr() }, context({ infrastructureReady: false })), /infrastructure gate/);
});

test('FAIL returns to the identical Claude worker and only that worker may resume', () => {
  const reviewing = task('REVIEW_REQUIRED');
  const failed = transition(reviewing, { kind: 'review', pr: pr(), review: review('FAIL') }, context());
  assert.deepEqual({ state: failed.state, workerId: failed.workerId }, { state: 'FIX_REQUIRED', workerId: reviewing.worker.id });
  assert.throws(() => transition({ ...reviewing, state: 'FIX_REQUIRED' }, { kind: 'resume', workerId: 'another-worker' }), /assigned worker/);
  assert.equal(transition({ ...reviewing, state: 'FIX_REQUIRED' }, { kind: 'resume', workerId: failed.workerId }).state, 'BUILDING');
  assert.throws(() => transition(reviewing, { kind: 'review', pr: pr(), review: review('FAIL', {}, { findings: [] }) }, context()), /findings must be an array with entries/);
});

test('a new push invalidates review even when an old GitHub approval remains visible', () => {
  const reviewing = task('REVIEW_REQUIRED');
  const pushed = pr({ head: { ref: branchFor('BB-1001'), sha: NEXT, repo: { full_name: 'mofwim/boekbrug' } } });
  assert.throws(() => transition(reviewing, { kind: 'review', pr: pushed, review: review('PASS') }, context()), /current head|stale/);
  assert.equal(transition(reviewing, { kind: 'invalidate', headChanged: true }).state, 'BUILDING');
  assert.equal(transition(task('VERIFIED'), { kind: 'invalidate', headChanged: true }).state, 'BUILDING');
  assert.throws(() => transition(task('VERIFIED'), { kind: 'invalidate' }), /changed head or base/);
  assert.throws(() => transition(reviewing, { kind: 'review', pr: pr(), review: review('PASS', { commit_id: NEXT }) }, context()), /anchored/);
});

test('a relevant main change invalidates review and requires a new handoff and checks', () => {
  const reviewing = task('REVIEW_REQUIRED');
  assert.throws(() => transition(reviewing, { kind: 'review', pr: pr(), review: review('PASS') }, context({ mainSha: NEXT })), /base changed/);
  assert.throws(() => transition(reviewing, { kind: 'review', pr: pr({ base: { ref: 'main', sha: NEXT } }), review: review('PASS') }, context()), /PR base snapshot/);
  assert.equal(transition(task('VERIFIED'), { kind: 'invalidate', baseChanged: true }).state, 'BUILDING');
  assert.throws(() => transition(reviewing, { kind: 'review', pr: pr(), review: review('PASS') }, context({ gates: { 'control-plane-tests': { conclusion: 'success', head_sha: NEXT } } })), /this head/);
});

test('self-review, mismatched identities, unknown unresolved items and absent diff cannot PASS', () => {
  const reviewing = task('REVIEW_REQUIRED');
  const invoke = (r, p = pr(), c = context()) => transition(reviewing, { kind: 'review', pr: p, review: r }, c);
  assert.throws(() => invoke(review('PASS', { user: { login: 'claude-builder' } }, { reviewer_login: 'claude-builder' }), pr(), context({ reviewerLogin: 'claude-builder' })), /cannot review own work/);
  assert.throws(() => invoke(review('PASS', {}, { reviewer_login: 'someone-else' })), /authenticated GitHub actor/);
  assert.throws(() => invoke(review('PASS'), pr({}, handoff({ unresolved_items: ['Needs owner decision'] }))), /unresolved items/);
  assert.throws(() => invoke(review('PASS'), pr(), context({ changedFiles: [] })), /changedFiles/);
  assert.throws(() => invoke(review('PASS'), pr(), context({ changedFiles: ['src/lib/vat.ts'] })), /changed scope/);
});

test('high-risk paths, shared surfaces and duplicate handoff blocks cannot enter the autonomous pilot', () => {
  const high = task('READY', { risk: { ...risk(), production: true } });
  assert.throws(() => transition(high, { kind: 'claim', workerId: high.worker.id }, context()), /material risk/);
  const product = task('READY', { allowed_areas: ['src/lib/'], reserved_areas: ['src/lib/'] });
  assert.throws(() => transition(product, { kind: 'claim', workerId: product.worker.id }, context()), /pilot area/);
  assert.throws(() => taskFromIssue(issue({ allowed_areas: ['docs/autonomy-pilot/'], reserved_areas: ['docs/other/'] })), /must be reserved/);
  const doubled = pr({ body: `${block(HANDOFF_MARKER, handoff())}\n${block(HANDOFF_MARKER, handoff())}` });
  assert.throws(() => handoffFromPr(doubled), /exactly one/);
});

test('BLOCKED requires a reason and release requires operator resolution', () => {
  const blocked = transition(task('BUILDING'), { kind: 'block', reason: 'dependency changed' });
  assert.equal(blocked.state, 'BLOCKED');
  assert.throws(() => transition(task('BLOCKED'), { kind: 'release' }, context()), /operator decision/);
  assert.equal(transition(task('BLOCKED'), { kind: 'release' }, context({ operatorApproved: true })).state, 'READY');
});
