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
-- ── THE MECHANISM: ONE LOCK PER ACCOUNTANT, TAKEN FIRST ─────────────────────
-- Every path that can change either side of the invariant is serialized per accountant, and then
-- re-reads. Because each statement in READ COMMITTED takes a fresh snapshot, the re-read after the
-- lock sees everything the previous holder committed — which is exactly what the first read could
-- not.
--
-- The serializer is a transaction-scoped advisory lock rather than a row lock, for one reason that
-- is not stylistic: the publish path may be an INSERT, and there is no row to lock before it
-- exists. A brand-new office whose first save IS a publish is an ordinary case (the route
-- upserts), and a mechanism that only works once the row exists would leave that case open.
--
-- The key is hashtextextended(accountant_id::text, 0) — 64 bits. Two different accountants could
-- in principle collide and serialize against each other for the length of one statement. That
-- costs a little contention and can never cost correctness, which is the right way round.
--
-- ── LOCK ORDER, AND WHY THERE IS NO DEADLOCK ────────────────────────────────
-- Two lock objects per accountant: the advisory lock, and the accountant_directory tuple once it
-- exists. ONE order for both, on every path: ADVISORY LOCK → DIRECTORY TUPLE. No path holds the
-- tuple and then waits for the advisory lock, so no two paths can wait on each other in a cycle.
--
--     publish by plain UPDATE          : directory tuple                  (takes no advisory lock)
--     publish by plain INSERT          : advisory → its own new tuple
--     UPSERT that inserts              : advisory → its own new tuple
--     UPSERT → ON CONFLICT DO UPDATE   : advisory → the existing directory tuple
--     unlink                           : accountant_clients tuple → advisory → directory tuple
--
-- The upsert rows are the ones that decide the order, and they are the application's real writer:
-- /api/kantoorgids publishes with supabase-js .upsert(), i.e. INSERT … ON CONFLICT DO UPDATE.
-- PostgreSQL fires the BEFORE INSERT trigger on the PROPOSED row before it discovers the conflict
-- and locks the existing tuple, so an upsert that takes the advisory lock at all takes it FIRST.
-- The order has to be built around that, because nothing inside a trigger can change it.
--
-- WHY A PLAIN UPDATE TAKES NO ADVISORY LOCK. PostgreSQL locks the tuple before any BEFORE UPDATE
-- trigger runs, so a lock taken there would be tuple → advisory — the reverse of every other path.
-- It does not need one. The unlink trigger locks this same tuple BEFORE it reads the evidence, so
-- a publishing UPDATE and an unlink are serialized on the tuple itself: whichever holds it first
-- finishes, and the other decides on a snapshot taken after that commit.
--
-- WHY EVERY INSERT TAKES IT, PUBLISHED OR NOT. An uncommitted row is invisible, so the unlink
-- trigger's FOR UPDATE cannot wait on a row that is still being inserted. A draft inserted and
-- published inside one transaction would otherwise reach COMMIT with nothing having serialized it
-- against an unlink. The same holds for an UPDATE that moves a row to another accountant_id, which
-- is an arrival at that accountant just like an insert. No session can do either — PostgREST runs
-- one statement per request, and accountant_directory_own_update pins accountant_id on both sides
-- — but the invariant is kept here for every writer, not only for the ones the route produces.
--
-- HOW THIS ORDER WAS ARRIVED AT, because the obvious alternatives were both tried and measured:
--   · e8ea973 took the advisory lock LAST ("after whatever row locks the path takes"). A plain
--     UPDATE fits that rule; the upsert cannot. Two connections on a real PostgreSQL — an upsert
--     publishing an existing draft, the last client unlinking — gave `deadlock detected`. Which
--     side dies depends on which waited longer, and both were measured: the office's save aborted
--     ("Opslaan is niet gelukt."), or the client's unlink aborted and the link stayed.
--   · Taking the tuple FIRST inside the publish trigger (FOR UPDATE, then advisory) closed that
--     two-party case and left a three-party one, found under stress: two first saves and an
--     unlink. The second first save finds no row to lock, waits for the lock, and meanwhile the
--     FIRST save commits the row; it then holds the advisory lock and needs that tuple, while the
--     unlink holds the tuple and needs the advisory lock. A row that did not exist when the lock
--     was requested cannot be locked before it.
-- The reverse order has no such case, because the only path that touches the tuple without the
-- advisory lock — the plain UPDATE — never asks for the advisory lock afterwards.
--
-- Outside this order, and said rather than discovered: a cascade from deleting a profile removes
-- links, and possibly the listing, in whatever order the foreign keys fire, and one statement may
-- touch several accountants in scan order. Those statements are not held to the table above. The
-- worst they can meet is a detected deadlock — one statement aborted and retried — and never a
-- published listing without evidence, because a deadlock victim commits nothing.

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
  -- A row ARRIVING at an accountant takes that accountant's lock: every INSERT, including the
  -- INSERT leg of the route's upsert, and an UPDATE that re-keys the row. It is the first lock
  -- this statement asks for, which is the order the whole file depends on — see LOCK ORDER above.
  -- On an INSERT the first test decides; OLD is NULL there, which makes the second test true as
  -- well, never an error.
  --
  -- A plain UPDATE of the office's own row takes NO advisory lock here: PostgreSQL already holds
  -- the tuple, and asking for the advisory lock now would reverse the order.
  IF TG_OP = 'INSERT' OR NEW.accountant_id IS DISTINCT FROM OLD.accountant_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.accountant_id::text, 0));
  END IF;

  IF NEW.published AND NOT EXISTS (
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
  '[KANTOORGIDS-BEWIJS] Weigert een publicatie waarvoor op het moment van COMMIT geen bevestigde klantkoppeling (meer) bestaat. Een rij die bij een boekhouder AANKOMT (INSERT, ook via upsert, of een UPDATE die accountant_id wijzigt) neemt eerst de advisory lock van die boekhouder; een gewone UPDATE niet, want die houdt de rij al vast. SECURITY INVOKER: leest alleen wat de aanroeper zelf al mag zien.';

REVOKE ALL ON FUNCTION public.accountant_directory_publication_needs_evidence()
  FROM PUBLIC, anon, authenticated, service_role;

-- No WHEN clause, on purpose. A draft INSERT must take the lock too (see LOCK ORDER), and a WHEN
-- on an INSERT OR UPDATE trigger cannot read OLD to spot a re-keying UPDATE. The function returns
-- at once for an UPDATE that neither publishes nor re-keys — the unlink trigger's own
-- `SET published = false` among them.
DROP TRIGGER IF EXISTS accountant_directory_publication_evidence ON public.accountant_directory;
CREATE TRIGGER accountant_directory_publication_evidence
  BEFORE INSERT OR UPDATE ON public.accountant_directory
  FOR EACH ROW
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

  -- LOCK ORDER, FIRST: the per-accountant serializer. This orders the unlink after any insert or
  -- upsert already in flight for this accountant, and every one that starts later waits for it.
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.accountant_id::text, 0));

  -- LOCK ORDER, SECOND: the directory row, and BEFORE the evidence is read. This is what
  -- serializes the unlink against a publishing plain UPDATE, which holds this tuple and takes no
  -- advisory lock: whichever of the two holds the row first finishes, and the other decides on a
  -- snapshot taken after that. Without it, an unlink that finds a draft would skip its UPDATE,
  -- hold nothing, and a publish validated against its still-uncommitted delete would commit.
  -- A no-op when no row exists; after the advisory lock, none can be in the middle of arriving.
  PERFORM 1 FROM public.accountant_directory
   WHERE accountant_id = OLD.accountant_id
     FOR UPDATE;

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
  '[KANTOORGIDS-BEWIJS] Zet een kantoorvermelding op published = false zodra de laatste bevestigde klantkoppeling verdwijnt. Neemt eerst de advisory lock per boekhouder en dan de directory-rij, zodat twee gelijktijdige ontkoppelingen elkaar niet allebei voor "niet de laatste" aanzien. SECURITY DEFINER omdat de klant die ontkoppelt geen rechten heeft op de rij van het kantoor. Raakt één kolom op één rij aan, publiceert nooit, verwijdert nooit.';

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
--    Behaviour under two and three real connections: scripts/sql-concurrency-test.sh scenarios
--    3 to 8, including the route's own upsert (6) and two first saves racing an unlink (7).
-- =====================================================================
