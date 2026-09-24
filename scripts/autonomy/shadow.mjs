/** A read-only review packet. No verdict or task state is recorded by this script. */
const REPO = 'mofwim/boekbrug';
const PILOT_CASES = new Set([384, 385, 386]);
const MAX_PATCH_BYTES = 200_000;

async function getJson(path, request = fetch) {
  const response = await request(`https://api.github.com/repos/${REPO}${path}`, {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub GET ${path}: ${response.status}`);
  return response.json();
}

async function allPages(path, request) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const next = await getJson(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, request);
    if (!Array.isArray(next)) throw new Error(`Expected list for ${path}`);
    items.push(...next);
    if (next.length < 100) return items;
  }
  throw new Error(`GitHub listing exceeded 20 pages: ${path}`);
}

export async function shadowPacket(number, request = fetch) {
  if (!PILOT_CASES.has(number)) throw new Error('shadow mode only permits existing PRs #384, #385, #386');
  const initial = await getJson(`/pulls/${number}`, request);
  const files = await allPages(`/pulls/${number}/files`, request);
  const reviews = await allPages(`/pulls/${number}/reviews`, request);
  const checks = await getJson(`/commits/${initial.head.sha}/check-runs?per_page=100`, request);
  if (!Array.isArray(checks.check_runs) || checks.total_count > checks.check_runs.length) {
    throw new Error(`Incomplete checks for PR #${number}`);
  }
  const status = await getJson(`/commits/${initial.head.sha}/status`, request);
  const latest = await getJson(`/pulls/${number}`, request);
  if (initial.head.sha !== latest.head.sha || initial.base.sha !== latest.base.sha) {
    throw new Error(`PR #${number} changed during read; discard packet and retry`);
  }
  return {
    mode: 'SHADOW_READ_ONLY', pr: number, url: initial.html_url, title: initial.title,
    state: initial.state, builder_github_login: initial.user?.login,
    base_sha: initial.base.sha, head_sha: initial.head.sha,
    issue_id: null, contract: 'LEGACY_PR_NO_AUTONOMY_ISSUE',
    changed_files: files.map(file => ({
      path: file.filename, status: file.status, additions: file.additions,
      deletions: file.deletions, patch: file.patch?.slice(0, MAX_PATCH_BYTES) ?? null,
      patch_incomplete: file.patch === undefined || file.patch.length > MAX_PATCH_BYTES,
    })),
    handoff: initial.body,
    github_reviews: reviews.map(review => ({ reviewer: review.user?.login, state: review.state, reviewed_head_sha: review.commit_id })),
    combined_status: status.state,
    check_runs: checks.check_runs.map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion, head_sha: check.head_sha })),
    verdict: null,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const numbers = process.argv.slice(2).flatMap(value => value.split(/[\s,]+/)).filter(Boolean).map(value => Number(value));
  if (!numbers.length) throw new Error('specify PR numbers (384 385 386)');
  for (const number of numbers) {
    const packet = await shadowPacket(number);
    process.stdout.write(`${JSON.stringify(packet)}\n`);
  }
}
