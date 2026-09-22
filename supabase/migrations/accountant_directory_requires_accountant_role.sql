-- supabase/migrations/accountant_directory_requires_accountant_role.sql
-- [KANTOORGIDS-ROL] Only an accountant may establish or publish an accountant-directory listing.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- accountant_directory is the table behind /boekhouders — the public page headed "Boekhouders die
-- met BoekBrug werken". Its write policies asked exactly one question:
--
--     WITH CHECK (accountant_id = (select auth.uid()))
--
-- That proves the writer owns the row. It does not prove the writer is an accountant, and the
-- foreign key does not either: `REFERENCES profiles(id)` says the id is a real profile, never that
-- the profile has role = 'accountant'.
--
-- /api/kantoorgids does check the role, but a route is one door. The Data API is another: the anon
-- key ships in every browser, and PostgREST will take a POST or PATCH on this table directly. So
-- any signed-in user — an ordinary ondernemer — could write themselves into the public list of
-- offices this product tells owners to trust, using their own uuid to satisfy the policy.
--
-- Nothing private leaks through it: RLS still pins the row to its writer, and there is no join out
-- of this table. What it costs is the only thing the page is for. A directory of offices "that
-- work with BoekBrug" that anyone can enter is not a weaker directory, it is a different object.
--
-- ── WHY THIS IS THE SAME FIX THE MANDATES ALREADY GOT ───────────────────────
-- mandate_requires_accountant_role (20260913223813) answered this exact shape on
-- has_active_invoice_mandate: ownership was being read as authority. This is that rule applied to
-- the one remaining accountant-shaped surface a session can write directly.
--
-- ── WHY NO SECURITY DEFINER, AND NO HELPER FUNCTION ─────────────────────────
-- Measured, not assumed (tests/sql/accountant_directory_rls.test.sql proves it): a plain EXISTS
-- over public.profiles works inside a policy even though profiles carries RLS, because the caller
-- needs to see only their OWN row and profiles_select_own already admits exactly that.
--
-- So no function is introduced. A SECURITY DEFINER helper here would buy nothing and cost the
-- whole checklist that comes with one — owner, signature, search_path, EXECUTE grants to PUBLIC /
-- anon / authenticated / service_role, and a new entry in the privilege registry. The smallest
-- safe repair is two policy bodies.
--
-- One consequence worth naming: the subquery reads profiles under the CALLER's rights, so a caller
-- who cannot see their own profile row reads as "not an accountant" and is refused. That is the
-- safe direction — the failure closes the door rather than opening it.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO: TRAP A ROW ──────────────────────────
-- A role guard written as "you must be an accountant to touch this row" would strand every listing
-- whose owner is no longer one. They could not unpublish it and could not correct it, and a public
-- listing its own office cannot take down is worse than the hole this file closes.
--
-- So the guard is on ESTABLISHING and on PUBLISHING, never on reaching the row:
--
--   INSERT  — needs the role. Creating the row IS establishing directory identity.
--   UPDATE  — USING stays ownership alone, so the owner always reaches their own row.
--             WITH CHECK needs the role only when the row COMES OUT published. Unpublishing,
--             emptying and correcting a draft stay open to whoever owns it.
--   DELETE  — untouched. Removing your own listing is never gated on anything but owning it.
--   SELECT  — untouched. Anonymous readers still see published rows and nothing else.
--
-- Read together: a non-accountant cannot create a listing and cannot publish one, and an office
-- that stops being an accountant can still take its listing down and delete it.

-- ── INSERT: establishing a listing needs the role ────────────────────────────
DROP POLICY IF EXISTS accountant_directory_own_write ON public.accountant_directory;
CREATE POLICY accountant_directory_own_write ON public.accountant_directory
  FOR INSERT TO authenticated
  WITH CHECK (
    accountant_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = (select auth.uid())
         AND p.role = 'accountant'
    )
  );

-- ── UPDATE: reaching the row is ownership, leaving it PUBLISHED needs the role ───────────────
--
-- The asymmetry between USING and WITH CHECK is the whole design, so it is spelled out:
--   USING      reads the row as it WAS  — ownership only, so nobody is locked out of their own row.
--   WITH CHECK reads the row as it WILL BE — published requires the role; not published does not.
DROP POLICY IF EXISTS accountant_directory_own_update ON public.accountant_directory;
CREATE POLICY accountant_directory_own_update ON public.accountant_directory
  FOR UPDATE TO authenticated
  USING (accountant_id = (select auth.uid()))
  WITH CHECK (
    accountant_id = (select auth.uid())
    AND (
      NOT published
      OR EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = (select auth.uid())
           AND p.role = 'accountant'
      )
    )
  );

COMMENT ON TABLE public.accountant_directory IS
  '[KANTOORGIDS] Kantoren die met BoekBrug werken, zoals het kantoor het zelf heeft ingevuld en aangezet. published = false is de standaard en de rij bestaat pas als het kantoor hem schrijft. Aanmaken en publiceren kan alleen met role = ''accountant'' ([KANTOORGIDS-ROL]); uitzetten en verwijderen kan de eigenaar altijd. Geen rang-, score- of betaalkolom: de volgorde komt uit accountant-directory.ts en is niet te koop.';

-- =====================================================================
-- CHECK — run AFTER applying. This migration has NOT been applied to production.
--
-- 1) Both policies carry the role test:
--    SELECT policyname, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_directory'
--       AND cmd IN ('INSERT','UPDATE');
--    Expected: both with_check mention profiles / role = 'accountant'.
--
-- 2) The read side did NOT move:
--    SELECT policyname, qual FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_directory' AND cmd='SELECT';
--    Expected: accountant_directory_public_read USING (published), unchanged, and
--              accountant_directory_own_read USING (accountant_id = auth.uid()), unchanged.
--
-- 3) Delete is still ownership alone:
--    SELECT qual FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_directory' AND cmd='DELETE';
--    Expected: (accountant_id = ( SELECT auth.uid() AS uid)) — no role test.
--
-- 4) Behaviour, proven rather than read: tests/sql/accountant_directory_rls.test.sql.
-- =====================================================================
