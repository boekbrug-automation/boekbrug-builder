-- supabase/migrations/intake_claims.sql
-- [INTAKE-CLAIM] The database backstop for the semantic-duplicate RACE.
--
-- Why this exists. The intake door's duplicate gate is read-then-insert: findSemanticDuplicate
-- SELECTs, and only then does the invoice INSERT run. The camera surface deliberately uploads
-- three files in parallel (MAX_PARALLEL_INTAKE), so the same paper photographed twice — different
-- bytes, so the byte-hash index cannot see it — can have BOTH requests pass the SELECT before
-- either has inserted. Both land, both can auto-advance, and the cost plus its voorbelasting is
-- booked twice. The byte-hash race has had a UNIQUE index behind it from day one
-- (uq_documents_user_content_hash); the SEMANTIC race had nothing, because the semantic key is
-- computed by TypeScript normalization that SQL cannot reproduce without becoming a second
-- authority on the key.
--
-- So the backstop stores the key WITHOUT recomputing it: a tiny claims table with a UNIQUE
-- (user_id, claim_key) index. The route computes the key (one authority, in code), INSERTs a
-- claim before it inserts the invoice, and a second in-flight upload of the same bill hits 23505
-- and is told the document is already being processed. Claims are short-lived working state, not
-- bookkeeping: a claim older than two minutes is stale (the request that made it is long dead)
-- and is taken over rather than honoured.
--
-- [EB-RACE] A SECOND user of this table, added later: the Enable Banking sync claims one linked
-- account for the length of one run, under the key 'ebsync:<bank_connection_accounts.id>'. Same
-- shape, same UNIQUE index, same deploy-safe degrade — but its own staleness rule (about seven
-- minutes, derived from the sync routes' maxDuration), because "the request that made it is long
-- dead" means something different for a two-minute upload and a five-minute bank read. The keys
-- are namespaced so the two never meet. What they DO share is the hourly hygiene sweep in
-- /api/intake, which deletes by age without reading the key: every TTL in this table must stay
-- well under that hour, and enablebanking-claim.test.ts asserts it rather than trusting this note.
--
-- One difference that matters for ROLLOUT: the intake door degrades when this table is missing
-- (42P01 -> proceed as before), because its worst case is a duplicate a human then sees in the
-- queue. The Enable Banking sync does NOT degrade — it REFUSES, because its worst case is the same
-- money imported twice into a btw-aangifte, silently. So this migration is a precondition of
-- enabling Enable Banking credentials, not something that can follow them.
--
-- [DEPLOY-SAFE] Code ships before this is applied by hand. The route treats a missing table
-- (42P01) as "no backstop yet" and proceeds exactly as today — the feature switches on when this
-- runs, with no second deploy.

create table if not exists public.intake_claims (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  claim_key   text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_intake_claims_user_key
  on public.intake_claims (user_id, claim_key);

-- Only the service-role pipeline touches this table (the route claims with it): no policies means
-- no access for anon/authenticated, which is exactly right for internal working state.
alter table public.intake_claims enable row level security;

-- ── CONTROLE ──
-- Bestaat de tafel en staat het unieke slot erop? Eén rij per vraag; allebei 't' is goed.
--   select exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'intake_claims') as tafel_bestaat;
--   select exists (select 1 from pg_indexes where indexname = 'uq_intake_claims_user_key') as slot_bestaat;
-- En blijft hij klein? (werk-staat hoort in de tientallen, nooit duizenden)
--   select count(*) as openstaande_claims from public.intake_claims;
