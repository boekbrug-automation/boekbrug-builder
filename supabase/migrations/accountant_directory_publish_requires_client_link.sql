-- supabase/migrations/accountant_directory_publish_requires_client_link.sql
-- [KANTOORGIDS-BEWIJS] A listing becomes PUBLIC on evidence, never on a self-declaration.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- accountant_directory is the table behind /boekhouders, the public page headed "Boekhouders die
-- met BoekBrug werken". Its write policies asked exactly one question:
--
--     WITH CHECK (accountant_id = (select auth.uid()))
--
-- That proves the writer owns the row. It does not prove the writer is an accountant, and the
-- foreign key does not either: `REFERENCES profiles(id)` says the id is a real profile, never that
-- the profile is an office's. /api/kantoorgids checks the role, but a route is one door and the
-- Data API is another: the anon key ships in every browser and PostgREST takes a POST on this
-- table directly. So any signed-in ondernemer could write themselves into the public list of
-- offices this product tells owners to trust.
--
-- ── WHY THIS DOES NOT GUARD `profiles.role`, THOUGH THAT IS THE OBVIOUS FIX ─
-- Because that fix was already written, tested and REJECTED in this repository, and the reasons
-- are recorded in ai_spend_guard.sql. They apply here word for word:
--
--   * IT IS BREAKING. Six legitimate paths write `profiles.role` with the user's OWN session
--     client (inventoried again for this migration, see the list below). A trigger that refuses
--     the column from a session breaks accountant registration, invitation acceptance in both
--     directions, and the onboarding reset.
--   * IT IS USELESS. /register has a role picker whose value flows through signup metadata into
--     handle_new_user(), which honours it. Anyone can simply choose "Boekhouder" at signup. A
--     guard on UPDATE closes nothing, because the front door was never locked.
--
-- So `role = 'accountant'` is a SELF-DECLARATION, and no trigger can make a self-declaration
-- trustworthy. An earlier version of this migration tested it anyway; it proved only that the
-- listing belonged to a profile whose role column currently said "accountant", which the profile's
-- own owner may write.
--
-- ── WHAT IS ACTUALLY TRUE, AND WHY ──────────────────────────────────────────
-- ai_spend_guard.sql answered the same question for the paywall and the answer transfers: the
-- access decision rests on EVIDENCE. Here the evidence is a row in accountant_clients naming this
-- caller as the accountant.
--
-- That row cannot be forged from a session, and this is enforced rather than assumed:
-- accountant_clients has a SELECT policy and a DELETE policy and NOTHING ELSE — the INSERT policy
-- was dropped in accountant_clients_insert_consent.sql (it had been an open self-link) and the
-- UPDATE policy in accountant_clients_update_consent.sql. The only writer is
-- /api/invite/accept on service_role, and only after the accepting user's e-mail is verified
-- against the invitation. Self-invitation is refused at both ends.
--
-- So holding such a row means a DIFFERENT, e-mail-verified party agreed to be this caller's
-- client. That is a fact about the world, not a checkbox about oneself.
--
-- The honest limit, written down rather than hidden: two people with two real accounts can invite
-- each other. That is the same bar the paywall exemption already accepts, it costs a second
-- verified e-mail address and a deliberate act by another party, and it is a far cry from "tick a
-- box during signup".
--
-- ── WHY PUBLISHING AND NOT WRITING ──────────────────────────────────────────
-- The guard is on the row being PUBLIC, not on the row existing. Gating INSERT on evidence would
-- stop a new office from so much as saving a draft until its first client lands — which is worse
-- than the defect this batch began with, and hits exactly the offices the gids exists for.
--
-- An unpublished row is readable by nobody but its owner (accountant_directory_public_read is
-- `USING (published)`), so a draft written by someone who will never qualify is a row no one can
-- see. Nothing reaches the public page without evidence, and that is the whole claim.
--
-- Read as one rule: A ROW MAY ONLY COME OUT PUBLISHED IF ITS OWNER HOLDS A CONSENTED CLIENT LINK.
-- INSERT and UPDATE carry the identical predicate, so there is no door where it is weaker.
--
-- ── AND NOBODY IS TRAPPED ───────────────────────────────────────────────────
-- USING on the UPDATE stays ownership alone, and DELETE is untouched. So an office that loses its
-- last client keeps every way out: it can still correct the row, still unpublish it, still delete
-- it. Only going public again needs the evidence back. A public listing its own owner cannot take
-- down would be worse than the hole this closes.
--
-- ── WHY NO SECURITY DEFINER, AND NO HELPER FUNCTION ─────────────────────────
-- Measured, not assumed (tests/sql/accountant_directory_rls.test.sql proves it): a plain EXISTS
-- over accountant_clients works inside a policy even though that table carries RLS, because the
-- caller needs only rows that name them, and accountant_clients_select already admits exactly
-- those. A SECURITY DEFINER helper would buy nothing and cost the whole checklist that comes with
-- one — owner, signature, search_path, EXECUTE grants to PUBLIC / anon / authenticated /
-- service_role, and an entry in the privilege registry.
--
-- The subquery reads under the CALLER's rights, so a caller who cannot see their own links reads
-- as "no evidence" and is refused. That is the safe direction: the failure closes the door.
--
-- ── THE ROLE-WRITE INVENTORY THIS MIGRATION RESTS ON ────────────────────────
-- Every writer of profiles.role in the tree, and the client each uses. All six are session
-- clients, which is precisely why guarding the column is breaking:
--   · src/app/api/auth/callback/route.ts:138   update role          — session
--   · src/app/api/invite/accept/route.ts:88    update role 'zzper'  — session
--   · src/app/api/invite/accept/route.ts:99    update role 'accountant' — session
--   · src/app/api/onboarding/reset/route.ts:46 update role NULL     — session
--   · src/app/onboarding/page.tsx:75           insert role 'zzper'  — session
--   · src/lib/documents.ts:234                 insert role 'zzper'  — session
-- Plus handle_new_user() on auth.users, which honours the role chosen at signup.
-- None of them is touched by this migration. That is the point of putting the boundary elsewhere.

-- ── INSERT: a row may be created freely; it may only be BORN published on evidence ────────────
DROP POLICY IF EXISTS accountant_directory_own_write ON public.accountant_directory;
CREATE POLICY accountant_directory_own_write ON public.accountant_directory
  FOR INSERT TO authenticated
  WITH CHECK (
    accountant_id = (select auth.uid())
    AND (
      NOT published
      OR EXISTS (
        SELECT 1 FROM public.accountant_clients ac
         WHERE ac.accountant_id = (select auth.uid())
      )
    )
  );

-- ── UPDATE: reaching the row is ownership; leaving it PUBLISHED needs the evidence ────────────
--
-- The asymmetry between USING and WITH CHECK is the whole design, so it is spelled out:
--   USING      reads the row as it WAS  — ownership only, so nobody is locked out of their own row.
--   WITH CHECK reads the row as it WILL BE — published needs evidence; not published does not,
--              which is what keeps unpublishing and correcting open to whoever owns the row.
DROP POLICY IF EXISTS accountant_directory_own_update ON public.accountant_directory;
CREATE POLICY accountant_directory_own_update ON public.accountant_directory
  FOR UPDATE TO authenticated
  USING (accountant_id = (select auth.uid()))
  WITH CHECK (
    accountant_id = (select auth.uid())
    AND (
      NOT published
      OR EXISTS (
        SELECT 1 FROM public.accountant_clients ac
         WHERE ac.accountant_id = (select auth.uid())
      )
    )
  );

COMMENT ON TABLE public.accountant_directory IS
  '[KANTOORGIDS] Kantoren die met BoekBrug werken, zoals het kantoor het zelf heeft ingevuld en aangezet. published = false is de standaard en de rij bestaat pas als het kantoor hem schrijft. PUBLICEREN kan alleen met minstens één bevestigde klantkoppeling in accountant_clients ([KANTOORGIDS-BEWIJS]) — niet op de zelfgekozen profiles.role; uitzetten en verwijderen kan de eigenaar altijd. Geen rang-, score- of betaalkolom: de volgorde komt uit accountant-directory.ts en is niet te koop.';

-- =====================================================================
-- CHECK — run AFTER applying. This migration has NOT been applied to production.
--
-- 1) Both write policies test the evidence, and neither tests the self-declaration:
--    SELECT policyname, with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_directory' AND cmd IN ('INSERT','UPDATE');
--    Expected: both mention accountant_clients; NEITHER mentions profiles or role.
--
-- 2) The evidence table is still unforgeable — this is what the policy leans on:
--    SELECT cmd FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_clients';
--    Expected: exactly SELECT and DELETE. An INSERT or UPDATE policy appearing here silently
--    turns the guard above back into a self-declaration.
--
-- 3) The read side did NOT move:
--    SELECT policyname, qual FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_directory' AND cmd='SELECT';
--    Expected: public_read USING (published) and own_read USING (accountant_id = auth.uid()).
--
-- 4) Delete is still ownership alone:
--    SELECT qual FROM pg_policies
--     WHERE schemaname='public' AND tablename='accountant_directory' AND cmd='DELETE';
--    Expected: (accountant_id = ( SELECT auth.uid() AS uid)) — no evidence test.
--
-- 5) Behaviour, proven by attempt rather than read: tests/sql/accountant_directory_rls.test.sql,
--    including the full self-promotion bypass (change own role, then try to publish).
-- =====================================================================
