-- [VERWERKT-WOORDENLIJST] The accountant_status vocabulary, back in the repository.
-- BoekBrug · September 2026
--
-- WHY THIS FILE EXISTS, AND WHY IT ADDS NOTHING
--
-- invoices.accountant_status carries the hardest money refusal this app has: while it reads
-- 'verwerkt', eleven guards across six SQL functions and eighteen TypeScript sites refuse to move
-- the invoice's paid state. The value is compared by EQUALITY everywhere, so the vocabulary is not
-- decoration — which strings exist decides which strings release the lock.
--
-- That vocabulary was enforced in production by a CHECK constraint, and by NOTHING in this
-- repository. Measured: `invoices_accountant_status_check` appears in no migration, and the repo's
-- own schema (database.sql) declared the column bare —
--
--     accountant_status text,
--
-- So a database rebuilt from this repository would accept any string in the column that every
-- payment guard reads. Not a behaviour change waiting to happen: a rebuild that is already wrong.
--
-- This file therefore reproduces what production ALREADY has, to the letter. It is not a design
-- decision and it introduces no state: the four values below were read out of the live constraint
-- with pg_get_constraintdef, and the predicate here normalises to exactly that definition.
--
--     CHECK (((accountant_status IS NULL) OR (accountant_status = ANY (ARRAY[
--       'te_verwerken'::text, 'in_behandeling'::text, 'verwerkt'::text, 'vraag'::text]))))
--
-- WHAT THE FOUR VALUES MEAN, AND WHICH OF THEM THE MONEY GUARDS CARE ABOUT
--
-- Only 'verwerkt' locks. NULL, 'te_verwerken', 'in_behandeling' and 'vraag' are all equally OPEN to
-- every guard — none of them is written as "IS NOT NULL", all of them as "= 'verwerkt'". That is
-- recorded here because the next reader's instinct is that anything non-NULL means "the accountant
-- has it", and that instinct is wrong in the one place where it moves money.
--
--   te_verwerken     the neutral default. Permitted here, and written by nothing on THIS column —
--                    it is the DEFAULT of accountant_subject_status.status, the separate per-
--                    accountant table. Kept because production has it: this file reproduces, it
--                    does not prune.
--   in_behandeling   the accountant has picked the document up.
--   verwerkt         the accountant asserts the document is processed. THE LOCK.
--   vraag            the accountant has asked the owner a question about it.
--
-- APPLY: run in the Supabase SQL editor. Deletes nothing. Idempotent. On production this is a
-- no-op in effect — the constraint it installs is the one already standing there.

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_accountant_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_accountant_status_check
  CHECK (
    accountant_status IS NULL OR accountant_status IN (
      'te_verwerken',    -- neutral default; written by nothing on this column
      'in_behandeling',  -- picked up by the accountant
      'verwerkt',        -- processed — the value every money guard tests for
      'vraag'            -- the accountant has a question for the owner
    )
  );

-- ── STATE CHECK ─────────────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'invoices_accountant_status_check';
--   → CHECK (((accountant_status IS NULL) OR (accountant_status = ANY (ARRAY['te_verwerken'::text,
--     'in_behandeling'::text, 'verwerkt'::text, 'vraag'::text]))))
-- SELECT count(*) FROM public.invoices
--  WHERE accountant_status IS NOT NULL
--    AND accountant_status NOT IN ('te_verwerken','in_behandeling','verwerkt','vraag');   → 0
