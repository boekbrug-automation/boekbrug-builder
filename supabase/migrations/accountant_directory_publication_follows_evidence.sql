-- supabase/migrations/accountant_directory_publication_follows_evidence.sql
-- [KANTOORGIDS-BEWIJS] published = true only while a consented client link exists. Under
-- concurrency too.
--
-- ── THE INVARIANT, IN ONE LINE ──────────────────────────────────────────────
--     COMMITTED STATE:  published = true  →  at least one current accountant_clients row exists
--
-- accountant_directory_publish_requires_client_link makes evidence a condition of WRITING a
-- published row, and that policy remains the authorization boundary. This file is what keeps the
-- invariant true in the two directions a write-time policy cannot see:
--
--   1. nothing is written at all — the last link is deleted and `published` simply stays true;
--   2. two transactions overlap, and each sees a world in which it is not the last one.
--
-- ── WHY A WRITE-TIME RULE IS NOT ENOUGH: THE SNAPSHOT ───────────────────────
-- Under READ COMMITTED — PostgREST's and this product's default — every statement takes its own
-- snapshot, and an uncommitted delete by another transaction is invisible. So a plain
-- `NOT EXISTS` in an AFTER DELETE trigger is wrong by construction the moment two people act at
-- once:
--
--     A holds L1 and L2, published = true
--     T1 deletes L1 → its trigger sees L2 still there   → "not the last one"
--     T2 deletes L2 → its trigger sees L1 still there   → "not the last one"
--     both commit  → zero links, published = true
--
-- Neither transaction is wrong about what it saw. That is the point: correctness here is not a
-- better predicate, it is SERIALIZATION. The same shape closes the publish-versus-unlink race,
-- where a publish validates against a link another transaction is in the middle of deleting.
--
-- ── THE MECHANISM: ONE LOCK PER ACCOUNTANT, TAKEN LAST ──────────────────────
-- Every path that can change either side of the invariant takes the SAME transaction-scoped
-- advisory lock, keyed on the accountant, and then re-reads. Because each statement in READ
-- COMMITTED takes a fresh snapshot, the re-read after the lock sees everything the previous holder
-- committed — which is exactly what the first read could not.
--
-- An advisory lock rather than a row lock, for one reason that is not stylistic: the publish path
-- may be an INSERT, and there is no row to lock before it exists. A brand-new office whose first
-- save IS a publish is an ordinary case (the route upserts), and a mechanism that only works once
-- the row exists would leave that case open.
--
-- The key is hashtextextended(accountant_id::text, 0) — 64 bits. Two different accountants could
-- in principle collide and serialize against each other for the length of one statement. That
-- costs a little contention and can never cost correctness, which is the right way round.
--
-- ── LOCK ORDER, AND WHY THERE IS NO DEADLOCK ────────────────────────────────
-- The rule is: the advisory lock is acquired LAST on every path, after whatever row locks that
-- path naturally takes. A single common resource, always acquired last, cannot be part of a
-- waits-for cycle.
--
--     publish by UPDATE   : accountant_directory tuple → advisory
--     publish by INSERT   : advisory                     (no pre-existing tuple to lock)
--     unlink              : accountant_clients tuple → accountant_directory tuple → advisory
--
-- The explicit `FOR UPDATE` in the unlink trigger is what makes that true, and it is not
-- decoration. Without it the unlink path would take the advisory lock BEFORE its UPDATE of
-- accountant_directory, i.e. advisory → directory tuple, which is the reverse of the publish
-- path's order — and a publisher holding the directory tuple while waiting for the advisory lock,
-- against an unlinker holding the advisory lock while waiting for that tuple, is a textbook
-- deadlock. PostgreSQL would detect and abort one of them, so it is not a correctness bug; it is
-- an avoidable failure, and avoiding it is one line.
--
-- Two unlinks of different clients take different accountant_clients tuples, then the same
-- directory tuple, then the same advisory lock — same order, no cycle. Two publishes contend on
-- the directory tuple first. A publish and an unlink share only the directory tuple and the
-- advisory lock, in that order on both sides.
--
-- ── WHY NOT A SMARTER READ POLICY ───────────────────────────────────────────
-- `USING (published AND EXISTS (… accountant_clients …))` would be a continuously evaluated
-- invariant and would need no locking at all. It was MEASURED on a real PostgreSQL and rejected,
-- not assumed: a policy's subquery runs with the CALLER's privileges, and anon reading a table
-- whose policy subqueries accountant_clients gets `permission denied for table …`. Making it work
-- needs either anon SELECT on accountant_clients — publishing every accountant-client
-- relationship in the product — or an anon-callable helper answering "does this uuid have
-- accountant clients", which is the enumeration oracle anon_mandate_oracle_revoke.sql already
-- closed once. Both are worse than a lock.
--
-- It is also the less honest shape: a read-time filter leaves published = true on a row nobody can
-- see, and the office's own panel reads that column — it would say "Je staat in de gids" over an
-- empty gids. Flipping the stored flag keeps ONE answer for the office, for anon, and for the
-- table.
--
-- ── WHY NOT IN /api/accountant/unlink ───────────────────────────────────────
-- Because that route is not the only door: accountant_clients_delete deliberately lets EITHER
-- party delete straight through the Data API, so an application-level fix is bypassed by the very
-- path the policy exists to allow.

-- ── 1. The publish side ──────────────────────────────────────────────────────
-- SECURITY INVOKER, deliberately. It only READS accountant_clients, and the office publishing its
-- own listing may already read exactly the rows that name it (accountant_clients_select). A DEFINER
-- function here would add a privileged surface for nothing. The failure direction is safe: a
-- caller who cannot see their links reads as "no evidence" and is refused.
--
-- It duplicates the WITH CHECK of accountant_directory_publish_requires_client_link on purpose.
-- The policy stays the authorization boundary and is not weakened; this re-asks the same question
-- with the lock held, which is the only way the answer is still true at COMMIT.
--
-- ERRCODE 42501 matches what the policy raises, so /api/kantoorgids maps both to the same Dutch
-- sentence instead of one of them falling through to "Opslaan is niet gelukt."
CREATE OR REPLACE FUNCTION public.accountant_directory_publication_needs_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Serialize against every other writer for THIS accountant, then look again. Taken after the
  -- row lock an UPDATE has already acquired, so the order is directory tuple → advisory.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.accountant_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.accountant_clients ac
     WHERE ac.accountant_id = NEW.accountant_id
  ) THEN
    RAISE EXCEPTION
      'Permission denied: publishing an accountant directory listing needs at least one consented client link (accountant_id: %)',
      NEW.accountant_id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.accountant_directory_publication_needs_evidence() IS
  '[KANTOORGIDS-BEWIJS] Weigert een publicatie waarvoor op het moment van COMMIT geen bevestigde klantkoppeling (meer) bestaat. Neemt per boekhouder een advisory lock zodat een gelijktijdige ontkoppeling niet langs de controle glipt. SECURITY INVOKER: leest alleen wat de aanroeper zelf al mag zien.';

REVOKE ALL ON FUNCTION public.accountant_directory_publication_needs_evidence()
  FROM PUBLIC, anon, authenticated, service_role;

-- WHEN (NEW.published): the lock is taken only by a write that actually leaves the row public.
-- A draft save takes no lock at all and contends with nothing.
DROP TRIGGER IF EXISTS accountant_directory_publication_evidence ON public.accountant_directory;
CREATE TRIGGER accountant_directory_publication_evidence
  BEFORE INSERT OR UPDATE ON public.accountant_directory
  FOR EACH ROW WHEN (NEW.published)
  EXECUTE FUNCTION public.accountant_directory_publication_needs_evidence();

-- ── 2. The unlink side ───────────────────────────────────────────────────────
-- SECURITY DEFINER, and it is required rather than convenient: the party deleting the link is very
-- often the CLIENT, who has no rights at all on the accountant's directory row
-- (accountant_directory_own_update pins every session write to accountant_id = auth.uid()). An
-- INVOKER function would silently update nothing in exactly the case this exists for.
--
-- It reads no session state — auth.uid() is never consulted — so the reaction is identical whether
-- the client unlinked, the office unlinked, or a service-role route did it.
CREATE OR REPLACE FUNCTION public.accountant_directory_unpublish_on_last_unlink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- accountant_id is nullable on this table. A NULL never matched a listing anyway.
  IF OLD.accountant_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- LOCK ORDER, FIRST HALF. The directory row before the advisory lock, so this path and the
  -- publish path acquire in the same order and cannot form a waits-for cycle. A no-op when the
  -- row does not exist or is not yet visible — harmless, and the advisory lock below is what
  -- covers that case.
  PERFORM 1 FROM public.accountant_directory
   WHERE accountant_id = OLD.accountant_id
     FOR UPDATE;

  -- LOCK ORDER, SECOND HALF. The per-accountant serializer, acquired last on every path.
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.accountant_id::text, 0));

  -- A NEW statement, therefore a NEW snapshot: this sees every delete committed by whoever held
  -- the lock before us. That is the whole correction — the same predicate read one snapshot later.
  IF NOT EXISTS (
    SELECT 1 FROM public.accountant_clients ac
     WHERE ac.accountant_id = OLD.accountant_id
  ) THEN
    -- The whole mutation, and deliberately the narrowest one that closes the hole: ONE column, on
    -- ONE row, and only while that row is actually published. It never deletes the listing, never
    -- touches what the office typed, and never publishes anything.
    --
    -- updated_at is left alone on purpose. It answers "when did the office last change this", and
    -- this was not the office.
    UPDATE public.accountant_directory
       SET published = false
     WHERE accountant_id = OLD.accountant_id
       AND published;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.accountant_directory_unpublish_on_last_unlink() IS
  '[KANTOORGIDS-BEWIJS] Zet een kantoorvermelding op published = false zodra de laatste bevestigde klantkoppeling verdwijnt. Neemt eerst de directory-rij en dan de advisory lock per boekhouder, zodat twee gelijktijdige ontkoppelingen elkaar niet allebei voor "niet de laatste" aanzien. SECURITY DEFINER omdat de klant die ontkoppelt geen rechten heeft op de rij van het kantoor. Raakt één kolom op één rij aan, publiceert nooit, verwijdert nooit.';

-- Nobody needs EXECUTE on either function. Supabase attaches a NAMED grant to anon, authenticated
-- and service_role on every new function, and REVOKE … FROM PUBLIC does not touch a named grantee
-- — that exact gap is why the privilege registry exists, so all four are named here.
--
-- The triggers keep firing regardless: PostgreSQL checks EXECUTE at CREATE TRIGGER, not per row.
-- Measured, not hoped — revoke_execute_on_trigger_functions.sql records the rolled-back proof.
REVOKE ALL ON FUNCTION public.accountant_directory_unpublish_on_last_unlink()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS accountant_clients_unpublish_directory ON public.accountant_clients;
CREATE TRIGGER accountant_clients_unpublish_directory
  AFTER DELETE ON public.accountant_clients
  FOR EACH ROW EXECUTE FUNCTION public.accountant_directory_unpublish_on_last_unlink();

-- ── The limits, written down rather than left to be discovered ───────────────
-- A row-level trigger does not fire on TRUNCATE, and neither trigger can be bypassed except by
-- disabling it. Both need table-owner rights, so they are reachable from no session and no route.
--
-- There is no UPDATE branch on accountant_clients because that table takes no UPDATE at all: the
-- policy was dropped in accountant_clients_update_consent.sql precisely so a link cannot be
-- re-pointed, and the [KANTOORGIDS-BEWIJS] gate fails any migration that gives it one back.

-- =====================================================================
-- CHECK — run AFTER applying. This migration has NOT been applied to production.
--
-- 1) Both triggers exist and are enabled:
--    SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     WHERE NOT t.tgisinternal
--       AND c.relname IN ('accountant_clients', 'accountant_directory');
--    Expected: accountant_clients_unpublish_directory and
--              accountant_directory_publication_evidence, both 'O'.
--
-- 2) Neither function is callable directly:
--    SELECT has_function_privilege('anon', 'public.accountant_directory_unpublish_on_last_unlink()', 'EXECUTE'),
--           has_function_privilege('authenticated', 'public.accountant_directory_publication_needs_evidence()', 'EXECUTE');
--    Expected: f, f (and the same for service_role).
--
-- 3) The invariant itself, on live data — the one query that answers the whole file:
--    SELECT d.accountant_id FROM public.accountant_directory d
--     WHERE d.published
--       AND NOT EXISTS (SELECT 1 FROM public.accountant_clients ac
--                        WHERE ac.accountant_id = d.accountant_id);
--    Expected: zero rows, at any moment.
--
-- 4) Behaviour under one connection: tests/sql/accountant_directory_rls.test.sql.
--    Behaviour under two real connections: scripts/sql-concurrency-test.sh scenarios 3 and 4.
-- =====================================================================
