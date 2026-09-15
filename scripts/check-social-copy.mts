// scripts/check-social-copy.mts
// [SOCIAL-CONTROLE] Run the marketing-copy gate over a corpus of posts.
//
// Run:   npx tsx scripts/check-social-copy.mts
//        SOCIAL_COPY=path/to/other.json npx tsx scripts/check-social-copy.mts
// Exit:  0 when every post checks out, 1 with a report when one does not.
//
// The rules themselves live in src/lib/social-copy.ts, with the test beside them, so they run
// inside `npm run gates` whether or not anyone remembers to run this script. This file only reads
// a corpus and prints. Two copies of a rule is how the gate and the campaign start disagreeing.

import { checkPosts, interfaceVocabulary, type SocialPost } from '../src/lib/social-copy'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const source = process.env.SOCIAL_COPY ?? path.join('docs', 'social', 'posts.json')

if (!existsSync(source)) {
  console.error(`[SOCIAL] no copy at ${source} — set SOCIAL_COPY to the file to check.`)
  process.exit(1)
}

const posts = JSON.parse(readFileSync(source, 'utf-8')) as SocialPost[]
const findings = checkPosts(posts, interfaceVocabulary())

for (const f of findings) {
  console.error(`[${f.rule}] ${f.post}: ${f.what}`)
  console.error(`    ${f.why}`)
  console.error(`    → ${f.evidence}`)
}

console.log(`\n[SOCIAL] ${posts.length} posts · ${findings.length} findings.`)
process.exit(findings.length === 0 ? 0 : 1)
