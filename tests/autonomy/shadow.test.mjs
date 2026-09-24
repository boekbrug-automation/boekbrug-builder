import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadowPacket } from '../../scripts/autonomy/shadow.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

function mockGitHub({ moved = false, incompleteChecks = false } = {}) {
  const calls = [];
  let reads = 0;
  const request = async (url, options) => {
    assert.equal(options.method, 'GET');
    calls.push(url);
    const path = new URL(url).pathname;
    let body;
    if (path.endsWith('/pulls/384')) {
      reads += 1;
      body = {
        head: { sha: moved && reads === 2 ? 'c'.repeat(40) : HEAD },
        base: { sha: BASE }, state: 'open', html_url: 'https://github.com/mofwim/boekbrug/pull/384',
        title: 'F-11', user: { login: 'mofwim' }, body: 'Legacy evidence',
      };
    } else if (path.endsWith('/pulls/384/files')) {
      body = [{ filename: 'src/lib/archive-expand.ts', additions: 2, deletions: 1, status: 'modified', patch: '@@ evidence' }];
    } else if (path.endsWith('/pulls/384/reviews')) {
      body = [];
    } else if (path.endsWith('/check-runs')) {
      body = { total_count: incompleteChecks ? 2 : 1, check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success', head_sha: HEAD }] };
    } else if (path.endsWith('/status')) {
      body = { state: 'success' };
    } else {
      throw new Error(`Unexpected URL ${url}`);
    }
    return { ok: true, json: async () => body };
  };
  return { request, calls };
}

test('legacy feature PR becomes read-only evidence; never a task or verdict', async () => {
  const fake = mockGitHub();
  const packet = await shadowPacket(384, fake.request);
  assert.equal(packet.mode, 'SHADOW_READ_ONLY');
  assert.equal(packet.issue_id, null);
  assert.equal(packet.verdict, null);
  assert.equal(packet.head_sha, HEAD);
  assert.equal(packet.base_sha, BASE);
  assert.equal(packet.changed_files[0].patch, '@@ evidence');
  assert.equal(packet.combined_status, 'success');
  assert.equal(fake.calls.length, 6);
  await assert.rejects(shadowPacket(999, fake.request), /only permits existing PRs/);
});

test('packet is discarded when a push races against collecting diff and checks', async () => {
  await assert.rejects(shadowPacket(384, mockGitHub({ moved: true }).request), /changed during read/);
});

test('incomplete check evidence is not silently treated as green', async () => {
  await assert.rejects(shadowPacket(384, mockGitHub({ incompleteChecks: true }).request), /Incomplete checks/);
});
