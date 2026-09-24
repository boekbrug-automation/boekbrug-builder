/**
 * Pure, fail-closed contracts for the opt-in engineering control plane.
 * Nothing here calls GitHub, changes a repository, or deploys the product.
 */
export const STATES = Object.freeze([
  'READY', 'BUILDING', 'REVIEW_REQUIRED', 'FIX_REQUIRED', 'VERIFIED', 'BLOCKED',
]);

export const LABEL_PREFIX = 'autonomy:';
export const TASK_MARKER = 'AUTONOMY_TASK_V1';
export const HANDOFF_MARKER = 'AUTONOMY_HANDOFF_V1';
export const REVIEW_MARKER = 'AUTONOMY_REVIEW_V1';

const SHA = /^[0-9a-f]{40}$/;
const TASK_ID = /^BB-[1-9]\d*$/;
const PILOT_PATHS = ['docs/autonomy-pilot/', 'tests/autonomy-pilot/'];
const SHARED_PATHS = [
  '.github/', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json',
  'supabase/', 'src/lib/lifecycle-gates.test.ts',
];
const IMPACTS = [
  'production', 'supabase_rls', 'vat', 'invoice_truth', 'bank_reconciliation',
  'payments', 'destructive_migration', 'secrets', 'customer_data_deletion',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, name) {
  assert(typeof value === 'string' && value.trim().length > 0, `${name} is required`);
  return value.trim();
}

function list(value, name, { empty = false } = {}) {
  assert(Array.isArray(value) && (empty || value.length > 0), `${name} must be an array${empty ? '' : ' with entries'}`);
  return value;
}

function sha(value, name) {
  assert(SHA.test(value ?? ''), `${name} must be a full commit SHA`);
  return value;
}

function area(value) {
  text(value, 'area');
  assert(!value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.') && !value.includes('\\') && !value.includes('*'), `unsafe area: ${value}`);
  return value;
}

function covers(reservation, file) {
  return reservation.endsWith('/') ? file.startsWith(reservation) : file === reservation;
}

function overlap(a, b) {
  return covers(a, b) || covers(b, a) || a === b;
}

export function readBlock(body, marker) {
  text(body, 'body');
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<!-- ${escaped} -->\\s*\x60\x60\x60json\\s*([\\s\\S]*?)\\s*\x60\x60\x60`, 'g');
  const matches = [...body.matchAll(pattern)];
  assert(matches.length === 1, `${marker} requires exactly one JSON block`);
  try {
    const result = JSON.parse(matches[0][1]);
    assert(result !== null && typeof result === 'object' && !Array.isArray(result), `${marker} must be an object`);
    return result;
  } catch (error) {
    throw new Error(`${marker} contains invalid JSON: ${error.message}`);
  }
}

export function taskFromIssue(issue) {
  assert(Number.isSafeInteger(issue?.number) && issue.number > 0 && !issue.pull_request, 'one GitHub Issue is required');
  const id = `BB-${issue.number}`;
  const record = readBlock(issue.body, TASK_MARKER);
  assert(record.task_id === id, `task ID must be ${id}`);
  text(record.scope, 'scope');
  const allowed = list(record.allowed_areas, 'allowed_areas').map(area);
  const reserved = list(record.reserved_areas, 'reserved_areas').map(area);
  assert(allowed.every(value => reserved.some(lock => covers(lock, value))), 'allowed areas must be reserved');
  const dependencies = list(record.dependencies, 'dependencies', { empty: true });
  assert(dependencies.every(value => TASK_ID.test(value) && value !== id), 'invalid or self-referencing dependency');
  assert(new Set(dependencies).size === dependencies.length, 'duplicate dependencies');
  list(record.acceptance_criteria, 'acceptance_criteria').forEach(value => text(value, 'acceptance criterion'));
  list(record.required_gates, 'required_gates').forEach(value => text(value, 'required gate'));
  text(record.worker?.id, 'worker.id');
  text(record.worker?.github_login, 'worker.github_login');
  assert(['low', 'medium', 'high'].includes(record.risk?.classification), 'risk classification is required');
  for (const impact of IMPACTS) {
    assert(typeof record.risk[impact] === 'boolean', `risk.${impact} must be explicit`);
  }
  const labels = (issue.labels ?? []).map(label => typeof label === 'string' ? label : label.name);
  const stateLabels = labels.filter(label => label?.startsWith(LABEL_PREFIX));
  assert(stateLabels.length === 1 && STATES.includes(stateLabels[0].slice(LABEL_PREFIX.length)), 'exactly one known autonomy state label is required');
  return { ...record, id, state: stateLabels[0].slice(LABEL_PREFIX.length), allowed_areas: allowed, reserved_areas: reserved };
}

export function pilotGuard(task, changedFiles = []) {
  assert(task.risk.classification === 'low' && IMPACTS.every(key => task.risk[key] === false), 'material risk is behind the manual gate');
  assert(task.allowed_areas.every(item => PILOT_PATHS.some(prefix => covers(prefix, item))), 'pilot area is outside the non-product allowlist');
  for (const file of changedFiles) {
    area(file);
    assert(task.allowed_areas.some(allowed => covers(allowed, file)), `out-of-scope file: ${file}`);
    assert(!SHARED_PATHS.some(shared => covers(shared, file)), `shared surface requires coordination: ${file}`);
  }
}

export function assertFreeReservation(task, otherTasks) {
  assert(Array.isArray(otherTasks), 'live reservations are required');
  for (const other of otherTasks) {
    if (other.id === task.id || !['BUILDING', 'REVIEW_REQUIRED', 'FIX_REQUIRED', 'VERIFIED'].includes(other.state)) continue;
    assert(other.worker?.id !== task.worker.id, `worker already assigned to ${other.id}`);
    assert(!task.reserved_areas.some(a => other.reserved_areas.some(b => overlap(a, b))), `area reserved by ${other.id}`);
  }
}

export function branchFor(taskId) {
  assert(TASK_ID.test(taskId), 'invalid task ID');
  return `claude/task-${taskId.toLowerCase()}`;
}

export function worktreeFor(taskId) {
  assert(TASK_ID.test(taskId), 'invalid task ID');
  return `../boekbrug-worker-${taskId.toLowerCase()}`;
}

export function checkDependencies(task, dependencies) {
  for (const id of task.dependencies) {
    const dep = dependencies?.[id];
    assert(dep?.state === 'VERIFIED' && dep?.merged === true, `dependency ${id} is not verified and merged`);
  }
}

function currentDiff(task, pr, handoff, context) {
  assert(context.infrastructureReady === true, 'infrastructure gate is not verified');
  assert(pr.state === 'open' && pr.base?.ref === 'main', 'task PR must be open against main');
  assert(pr.base.sha === context.mainSha, 'PR base snapshot differs from current main');
  assert(pr.user?.login === task.worker.github_login, 'PR author is not the assigned worker');
  assert(pr.head?.repo?.full_name === 'mofwim/boekbrug', 'task branch must belong to BoekBrug');
  assert(pr.head?.ref === branchFor(task.id), 'PR branch does not belong to task');
  assert(pr.head?.sha === handoff.head_sha && context.mainSha === handoff.base_sha, 'handoff head/base is stale');
  const changed = list(context.changedFiles, 'changedFiles').map(area);
  assert(changed.length === handoff.changed_scope.length && changed.every(file => handoff.changed_scope.includes(file)), 'changed scope differs from GitHub diff');
  pilotGuard(task, changed);
  checkDependencies(task, context.dependencies);
  assertFreeReservation(task, context.activeTasks);
  for (const gate of task.required_gates) {
    const result = context.gates?.[gate];
    assert(result?.conclusion === 'success' && result.head_sha === pr.head.sha, `required gate is not green on this head: ${gate}`);
  }
}

export function handoffFromPr(pr) {
  const handoff = readBlock(pr?.body, HANDOFF_MARKER);
  assert(TASK_ID.test(handoff.task_id ?? ''), 'handoff task ID is required');
  sha(handoff.base_sha, 'handoff.base_sha');
  sha(handoff.head_sha, 'handoff.head_sha');
  list(handoff.changed_scope, 'changed_scope').forEach(area);
  list(handoff.evidence, 'evidence').forEach(value => text(value, 'evidence item'));
  list(handoff.risks, 'risks', { empty: true });
  list(handoff.unresolved_items, 'unresolved_items', { empty: true });
  for (const field of ['migrations', 'data', 'security']) text(handoff.impact?.[field], `impact.${field}`);
  return handoff;
}

export function reviewFromGitHub(review) {
  const payload = readBlock(review?.body, REVIEW_MARKER);
  assert(['PASS', 'FAIL'].includes(payload.verdict), 'review verdict must be PASS or FAIL');
  assert(TASK_ID.test(payload.task_id ?? ''), 'review task ID is required');
  sha(payload.reviewed_head_sha, 'reviewed_head_sha');
  sha(payload.base_sha, 'review.base_sha');
  list(payload.findings, 'findings').forEach(value => text(value, 'finding'));
  const reviewerLogin = text(review.user?.login, 'authenticated reviewer');
  assert(payload.reviewer_login === reviewerLogin, 'reviewer identity differs from authenticated GitHub actor');
  assert(review.commit_id === payload.reviewed_head_sha, 'GitHub review is anchored to a different commit');
  assert(review.state === (payload.verdict === 'PASS' ? 'APPROVED' : 'CHANGES_REQUESTED'), 'GitHub review state and verdict disagree');
  return { ...payload, reviewerLogin };
}

export function transition(task, event, context = {}) {
  assert(STATES.includes(task?.state), 'unknown task state');
  const result = (state, reason) => ({ state, taskId: task.id, workerId: task.worker.id, reason });
  if (event.kind === 'block') return result('BLOCKED', text(event.reason, 'block reason'));
  if (event.kind === 'invalidate' && ['VERIFIED', 'REVIEW_REQUIRED'].includes(task.state)) {
    assert(event.headChanged || event.baseChanged, 'invalidation requires a changed head or base');
    return result('BUILDING', 'the previous review and handoff are stale');
  }
  if (event.kind === 'claim' && task.state === 'READY') {
    assert(event.workerId === task.worker.id, 'only the assigned worker can claim this task');
    pilotGuard(task);
    checkDependencies(task, context.dependencies);
    assertFreeReservation(task, context.activeTasks);
    assert(context.infrastructureReady === true, 'infrastructure gate is not verified');
    return result('BUILDING', 'claimed by the assigned worker');
  }
  if (event.kind === 'submit' && task.state === 'BUILDING') {
    const pr = event.pr;
    const handoff = handoffFromPr(pr);
    assert(handoff.task_id === task.id, 'PR handoff belongs to another task');
    currentDiff(task, pr, handoff, context);
    return result('REVIEW_REQUIRED', 'exact head ready for independent review');
  }
  if (event.kind === 'review' && task.state === 'REVIEW_REQUIRED') {
    const review = reviewFromGitHub(event.review);
    const handoff = handoffFromPr(event.pr);
    assert(review.task_id === task.id && handoff.task_id === task.id, 'review task mismatch');
    assert(review.reviewerLogin !== task.worker.github_login, 'builder cannot review own work');
    assert(review.reviewerLogin === context.reviewerLogin, 'reviewer is not the designated independent identity');
    assert(review.reviewed_head_sha === event.pr.head?.sha && handoff.head_sha === event.pr.head?.sha, 'PASS/FAIL does not belong to current head');
    assert(review.base_sha === context.mainSha && handoff.base_sha === context.mainSha, 'base changed since review');
    currentDiff(task, event.pr, handoff, context);
    if (review.verdict === 'FAIL') {
      assert(review.findings.length > 0, 'FAIL requires concrete findings');
      return result('FIX_REQUIRED', 'return to the same assigned worker');
    }
    assert(handoff.unresolved_items.length === 0, 'PASS is blocked by unresolved items');
    return result('VERIFIED', 'independent PASS on current head and base');
  }
  if (event.kind === 'resume' && task.state === 'FIX_REQUIRED') {
    assert(event.workerId === task.worker.id, 'only the assigned worker can resume a FAIL');
    return result('BUILDING', 'assigned worker fixes review findings');
  }
  if (event.kind === 'release' && task.state === 'BLOCKED') {
    assert(context.operatorApproved === true, 'BLOCKED requires an operator decision');
    pilotGuard(task);
    checkDependencies(task, context.dependencies);
    return result('READY', 'block resolved');
  }
  throw new Error(`transition ${task.state} -> ${event.kind} is not permitted`);
}
