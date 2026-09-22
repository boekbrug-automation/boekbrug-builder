-- supabase/migrations/accountant_directory_unpublish_on_last_unlink.sql
-- [KANTOORGIDS-BEWIJS] When the last client link goes, the listing stops being public. Atomically.
--
-- ── THE HOLE THIS CLOSES ────────────────────────────────────────────────────
-- accountant_directory_publish_requires_client_link makes evidence a condition of WRITING a
-- published row. `published` is then a STORED fact that nothing re-reads, so:
--
--     A holds a link  →  A publishes  →  published = true
--     the client unlinks  →  the accountant_clients row is DELETEd
--     nothing writes accountant_directory  →  published stays true
--     anon SELECT  →  still sees A, indefinitely
--
-- The public read policy is `USING (published)` and asks nothing else, so the listing outlives the
-- relationship it rests on. That contradicts the rule the batch now states — public visibility
-- rests on CURRENT consented evidence — and it contradicts the sibling migration's own words,
-- that publication must not survive the evidence disappearing.
--
-- The write-time rule is not wrong; it is simply blind to the direction where nothing is written.
-- This file covers that direction and nothing else.
--
-- ── WHY NOT SIMPLY TEACH THE READ POLICY TO CHECK ───────────────────────────
-- The obvious shape is `USING (published AND EXISTS (SELECT 1 FROM accountant_clients …))`, which
-- would be a continuously evaluated invariant rather than a reaction. It was MEASURED on a real
-- PostgreSQL before being rejected, not assumed:
--
--     anon SELECT on a table whose policy subqueries a table anon may not read
--       →  ERROR: permission denied for table …
--
-- A policy's subquery runs with the CALLER's privileges. So that shape needs one of two things,
-- and both are worse than this file:
--
--   · GRANT SELECT on accountant_clients to anon — which publishes every accountant↔client
--     relationship in the product to the open internet. That is the single most private table in
--     this domain; see the public/private map. Refused outright.
--   · a SECURITY DEFINER helper that anon may EXECUTE — which is an enumeration oracle: ask it
--     about any uuid and learn whether that person has accountant clients. This repository has
--     already closed exactly that class once (anon_mandate_oracle_revoke.sql). Refusing to reopen
--     it is not a preference.
--
-- ── AND WHY THE REACTION IS ALSO THE MORE HONEST SHAPE ──────────────────────
-- A read-time filter would leave `published = true` on a row nobody can see. The office's own
-- panel reads that column and would go on saying "Je staat in de gids" while the gids showed
-- nothing. Flipping the stored flag keeps ONE answer to "am I listed", for the office, for anon,
-- and for anyone reading the table later.
--
-- ── WHY NOT IN /api/accountant/unlink ───────────────────────────────────────
-- Because that route is not the only door. accountant_clients_delete deliberately lets EITHER
-- party delete the row directly through the Data API, so an app-level fix would be bypassed by the
-- very path the policy exists to allow. The reaction belongs where the delete happens.

-- ── The function ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER, and it is required rather than convenient: the party deleting the link is
-- very often the CLIENT, who has no rights at all on the accountant's directory row
-- (accountant_directory_own_update pins every session write to accountant_id = auth.uid()). An
-- INVOKER function would simply update nothing in exactly the case this file exists for, and would
-- do so silently.
--
-- It reads no session state. auth.uid() is never consulted, so the reaction is identical whether
-- the client unlinked, the office unlinked, or a service-role route did it. That is deliberate:
-- the fact that matters is that the last link is gone, not who removed it.
CREATE OR REPLACE FUNCTION public.accountant_directory_unpublish_on_last_unlink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- accountant_id is nullable on this table. A NULL never matched a listing anyway, and comparing
  -- to it below would be a no-op with a confusing shape; refuse it explicitly instead.
  IF OLD.accountant_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- AFTER DELETE, so the removed row is already gone: this asks whether ANY link is left. On a
  -- multi-row delete the trigger fires per row and only the last one finds none, which is exactly
  -- the required behaviour — a listing survives losing one of two clients.
  IF NOT EXISTS (
    SELECT 1 FROM public.accountant_clients ac
     WHERE ac.accountant_id = OLD.accountant_id
  ) THEN
    -- The whole mutation, and it is deliberately the narrowest one that closes the hole: ONE
    -- column, on ONE row, and only while that row is actually published. It never deletes the
    -- listing, never touches what the office typed, and never publishes anything.
    --
    -- updated_at is left alone on purpose. It answers "when did the office last change this",
    -- and this was not the office. Widening the mutation to keep a timestamp tidy would widen
    -- what a SECURITY DEFINER function is allowed to write, which is the wrong trade.
    UPDATE public.accountant_directory
       SET published = false
     WHERE accountant_id = OLD.accountant_id
       AND published;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.accountant_directory_unpublish_on_last_unlink() IS
  '[KANTOORGIDS-BEWIJS] Zet een kantoorvermelding op published = false zodra de laatste bevestigde klantkoppeling verdwijnt. SECURITY DEFINER omdat de klant die ontkoppelt geen rechten heeft op de rij van het kantoor. Raakt één kolom op één rij aan, publiceert nooit, verwijdert nooit.';

-- ── The grants, all four paths decided ───────────────────────────────────────
-- Nobody needs EXECUTE. Supabase attaches a NAMED grant to anon, authenticated and service_role on
-- every new function, and REVOKE … FROM PUBLIC does not touch a named grantee — that exact gap is
-- why the privilege registry exists, so all four are named here rather than assumed.
--
-- The trigger keeps firing regardless: PostgreSQL checks EXECUTE at CREATE TRIGGER, not per row.
-- That is measured, not hoped — revoke_execute_on_trigger_functions.sql records the rolled-back
-- proof on six existing guards.
REVOKE ALL ON FUNCTION public.accountant_directory_unpublish_on_last_unlink()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── The trigger ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS accountant_clients_unpublish_directory ON public.accountant_clients;
CREATE TRIGGER accountant_clients_unpublish_directory
  AFTER DELETE ON public.accountant_clients
  FOR EACH ROW EXECUTE FUNCTION public.accountant_directory_unpublish_on_last_unlink();

-- ── The limit, written down rather than left to be discovered ────────────────
-- A row-level trigger does not fire on TRUNCATE. TRUNCATE on accountant_clients needs table-owner
-- rights, so it is reachable from no session and from no route — but it is the one way the last
-- link can vanish without this reaction, and a reader deserves to know that rather than infer it.
-- The same applies to disabling the trigger, which is equally owner-only.
--
-- There is no UPDATE branch because accountant_clients takes no UPDATE at all: the policy was
-- dropped in accountant_clients_update_consent.sql precisely so a link cannot be re-pointed, and
-- the [KANTOORGIDS-BEWIJS] gate fails any migration that gives it one back.

-- =====================================================================
-- CHECK — run AFTER applying. This migration has NOT been applied to production.
--
-- 1) The trigger exists and is enabled:
--    SELECT tgname, tgenabled FROM pg_trigger
--     WHERE tgrelid = 'public.accountant_clients'::regclass AND NOT tgisinternal;
--    Expected: accountant_clients_unpublish_directory, 'O'.
--
-- 2) Nobody can execute the function directly:
--    SELECT has_function_privilege('anon', 'public.accountant_directory_unpublish_on_last_unlink()', 'EXECUTE'),
--           has_function_privilege('authenticated', 'public.accountant_directory_unpublish_on_last_unlink()', 'EXECUTE'),
--           has_function_privilege('service_role', 'public.accountant_directory_unpublish_on_last_unlink()', 'EXECUTE');
--    Expected: f, f, f.
--
-- 3) No published listing is left without evidence — the invariant itself, on live data:
--    SELECT d.accountant_id FROM public.accountant_directory d
--     WHERE d.published
--       AND NOT EXISTS (SELECT 1 FROM public.accountant_clients ac
--                        WHERE ac.accountant_id = d.accountant_id);
--    Expected: zero rows. Any row here is a listing that outlived its relationship.
--
-- 4) Behaviour, proven by attempt: tests/sql/accountant_directory_rls.test.sql.
-- =====================================================================
