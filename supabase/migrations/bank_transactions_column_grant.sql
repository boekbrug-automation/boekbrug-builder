-- =====================================================================
-- [KOLOMRECHT] A session may write three columns on bank_transactions, not the whole row.
-- BoekBrug · September 2026
-- =====================================================================
-- WHAT WAS OPEN. [ALLOCATIE-DEUR] made bank_tx_invoices read-only to a logged-in session. That
-- closed the CHILD. The parent was untouched, and every effect the child's policies used to allow
-- was still reachable one level up. Measured on production, rollback-only, as role `authenticated`
-- with the owner's own auth.uid():
--
--   UPDATE bank_transactions SET invoice_id, status   -> 1 row written
--   UPDATE a REAL pending line -> 'matched'           -> 1 row written
--   DELETE bank_transactions                          -> 1 row; its allocations cascaded to 0
--
-- So a session could repoint a line at an invoice no allocation backs (the exact state
-- confirm_bank_payment refuses to BOOK on, which says nothing about producing it), hide a line from
-- the matcher by flipping its status, or delete a booked line and take its allocations with it.
-- bank_transactions carries no trigger at all; RLS was the only thing in the way, and RLS scopes
-- ROWS, not columns.
--
-- WHY THIS COSTS NOTHING. Measured over src/ at main: bank_transactions has 30 write sites. 27 run
-- on the service-role `pipeline` client, which bypasses RLS. THREE run on the session client, all
-- three in /api/bank/categorize, and all three write only `category`, `category_source` and
-- `category_confirmed`. Not one session write touches invoice_id or status.
--
-- THE MECHANISM, proven on scratch before this file was written. A column-scoped UPDATE grant sits
-- underneath RLS rather than beside it, so both apply:
--   · the three category columns on the owner's OWN row  -> written
--   · the same columns on ANOTHER user's row             -> 0 rows (the update_own policy filters)
--   · invoice_id, status, amount, date, user_id          -> refused 42501
--   · a MIXED update naming category and invoice_id      -> refused 42501 (the whole statement)
--   · a SECURITY DEFINER door setting invoice_id+status  -> unaffected
--   · the owner / service_role                           -> unaffected
--
-- THE DELETE DOOR, measured separately rather than assumed. bank_transactions is deleted in exactly
-- two places: /api/bank/delete-line (guarded `.is("invoice_id", null).neq("status","matched")`) and
-- /api/bank/delete-statement (which un-pays the statement's invoices first and re-pays them if the
-- delete fails). BOTH run on `pipeline`. No session flow deletes a bank transaction, so the policy
-- that allows one is removed too.
--
-- WHAT THIS IS NOT. No trigger, no CHECK, no new door, no RLS redesign. The row-level ownership
-- policy for UPDATE stays exactly as it was; this narrows WHICH COLUMNS that policy can reach.
-- INSERT and SELECT are untouched.
-- =====================================================================

BEGIN;

-- [PRECONDITIE] This is the FIRST file in this repository to touch bank_transactions RLS at all:
-- the base policies and the RLS switch came from the original dashboard setup and live in no
-- migration, exactly like the invoices base policies. Production has RLS on — verified — but this
-- file may not merely HOPE so: a column grant under a table whose RLS is off protects the columns
-- and nothing else, and the ownership rule below would be decoration. Idempotent; a no-op on
-- production.
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

-- The row-level ownership rule is unchanged and re-asserted, so this file states the whole shape it
-- leaves behind rather than only the half it narrows.
DROP POLICY IF EXISTS bank_transactions_update_own ON public.bank_transactions;
CREATE POLICY bank_transactions_update_own ON public.bank_transactions
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- Table-wide UPDATE goes; the three columns a session legitimately edits come back by name.
REVOKE UPDATE ON public.bank_transactions FROM authenticated;
GRANT  UPDATE (category, category_source, category_confirmed)
  ON public.bank_transactions TO authenticated;

-- No session flow deletes a bank transaction — both delete paths are service-role and route-guarded.
DROP POLICY IF EXISTS bank_transactions_delete_own ON public.bank_transactions;

COMMIT;

-- ── VERIFY ──────────────────────────────────────────────────────────────────────────────────
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid='public.bank_transactions'::regclass;
--     → insert_own | a ,  select_own | r ,  update_own | w      (three rows, no delete)
--
--   SELECT column_name FROM information_schema.column_privileges
--    WHERE table_name='bank_transactions' AND grantee='authenticated' AND privilege_type='UPDATE';
--     → category, category_source, category_confirmed            (three rows, nothing else)
