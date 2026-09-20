-- =====================================================================
-- [VRAAG-SYNC] The accountant's direct write path to an invoice question row is closed.
-- BoekBrug · September 2026
-- =====================================================================
-- WHY
--
-- accountant_invoice_status_sync.sql made the invoice-question lifecycle one transaction: the
-- function accountant_set_invoice_status moves `invoices.accountant_status` and the accountant's
-- own row in accountant_subject_status together, and the application routes go through it.
--
-- But the database still let an authenticated accountant session write those rows on its own.
-- acc_status_owner_write (accountant_write_holes.sql) is FOR ALL and allows, for a linked and
-- shared invoice, a direct INSERT of a question row, an UPDATE of its status or its words, a
-- DELETE, or a move to another subject — none of which moves `invoices.accountant_status` in the
-- same transaction. With the anon key in every browser, that is the split truth VR-01 removed,
-- reachable again through the ordinary Data API (review of PR #371, blocker 1).
--
-- WHAT CHANGES, AND WHAT DOES NOT
--
--   · acc_status_owner_write is re-created with its `subject_type = 'document'` branch only. The
--     document branch is byte-for-byte the one accountant_write_holes.sql wrote (the linked-client
--     requirement through is_my_accountant_client); the invoice branch is gone. An invoice row
--     can therefore no longer be inserted, updated, deleted or moved by any session client; the
--     server's function still can, because service_role bypasses RLS.
--   · The document workflow is untouched: /api/accountant/subject-status keeps writing document
--     rows with the accountant's session, exactly as before.
--   · Every SELECT path stays as it is: acc_status_owner_read (the accountant's own archive, AV
--     §7.4), acc_status_client_read_document and acc_status_client_read_invoice (the client reads
--     the questions about their own things) are not touched by this file.
--   · No function, no grant, no default privilege is created or changed.
--
-- The stale FOR ALL policy from accountant_subject_status.sql is dropped if it still exists, so
-- that an environment built from the repo alone (no accountant_write_holes.sql yet) ends in the
-- same state as production. In production that DROP is a no-op.
--
-- TOEPASSEN: Supabase SQL-editor. Idempotent. Removes no data.
-- =====================================================================

DROP POLICY IF EXISTS acc_status_owner_all ON public.accountant_subject_status;

DROP POLICY IF EXISTS acc_status_owner_write ON public.accountant_subject_status;
CREATE POLICY acc_status_owner_write ON public.accountant_subject_status
  FOR ALL
  USING (
    accountant_id = auth.uid()
    AND subject_type = 'document'
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = accountant_subject_status.subject_id
        AND public.is_my_accountant_client(d.user_id)
    )
  )
  WITH CHECK (
    accountant_id = auth.uid()
    AND subject_type = 'document'
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = accountant_subject_status.subject_id
        AND public.is_my_accountant_client(d.user_id)
    )
  );

COMMENT ON POLICY acc_status_owner_write ON public.accountant_subject_status IS
  '[VRAAG-SYNC] Sessions write DOCUMENT status rows only, over a linked client''s document. An invoice question row has one write path: the server door and accountant_set_invoice_status, which move it together with invoices.accountant_status in one transaction.';

-- ── STATE CHECK ─────────────────────────────────────────────────────────────────────────────
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'accountant_subject_status' ORDER BY 1;
--   acc_status_client_read_document  SELECT
--   acc_status_client_read_invoice   SELECT
--   acc_status_owner_read            SELECT
--   acc_status_owner_write           ALL      ← qual contains "subject_type = 'document'" and no invoice branch
-- SELECT count(*) FROM pg_policies WHERE tablename = 'accountant_subject_status' AND policyname = 'acc_status_owner_all';  → 0
