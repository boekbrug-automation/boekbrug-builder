-- =====================================================================
-- [VRAAG-SYNC] One accountant, one invoice: the invoice's workflow status and the accountant's
-- question about it move together, in one transaction.
-- BoekBrug · September 2026
-- =====================================================================
-- WHY
--
-- An invoice question lives in two places. `invoices.accountant_status = 'vraag'` is what the
-- accountant's own surfaces count (the "Open vraag" KPI, the red dot, the werkboard todo).
-- `accountant_subject_status` (subject_type = 'invoice') carries the accountant's words, and is
-- what the client's /dashboard/vragen lists and what the client's home counts.
--
-- Asking wrote both. Resolving wrote ONE: the door (src/lib/accountant-status-door.ts) moved
-- `invoices.accountant_status` to 'verwerkt' and nothing ever moved the question row. So the
-- client kept reading "Je boekhouder heeft een vraag" about an invoice the accountant had long
-- finished, with no way to make it stop — measured in the Phase 2 audit (VR-01).
--
-- Two separate writes from the application cannot fix that: a failure between them is exactly
-- the contradiction being fixed. This function is the one place both facts change, and PostgreSQL
-- makes it one transaction: either the invoice AND the question row move, or neither does.
--
-- SCOPE, deliberately narrow
--
--   · exactly one accountant (p_accountant_id) and exactly one invoice (p_invoice_id);
--   · the accountant must be linked to the client (accountant_clients), and the invoice must
--     belong to that client — both re-checked here, not only by the caller;
--   · another accountant's question on the same invoice is never touched: the question row is
--     addressed by (accountant_id, 'invoice', subject_id);
--   · the client never calls this: EXECUTE is revoked from PUBLIC, anon and authenticated. The
--     client answers through /api/messages; that path does not exist in this function.
--
-- WHO RUNS IT
--
-- The server door only, through the service-role client (SECURITY INVOKER, so it runs with the
-- caller's rights and never lends anyone else's). The `invoices_accountant_door` trigger keeps
-- refusing every session write of `accountant_status`; the door's checks through the SESSION
-- client (who is calling, may they see this invoice) stay in front of this call, unchanged.
--
-- No privilege-default or SECURITY DEFINER work: this file creates one INVOKER function and
-- decides its four EXECUTE paths explicitly, as scripts/privilege-registry.ts requires.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.accountant_set_invoice_status(
  p_accountant_id uuid,
  p_client_id     uuid,
  p_invoice_id    uuid,
  p_status        text,
  p_question      text DEFAULT NULL
)
RETURNS TABLE (previous_status text, question_was_open boolean, question_status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      timestamptz := now();
  v_prev     text;
  v_qprev    text;
  v_qstatus  text;
  v_question text := nullif(btrim(coalesce(p_question, '')), '');
BEGIN
  IF p_accountant_id IS NULL OR p_client_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  -- The four words of invoices.accountant_status, or NULL to clear it. Nothing else.
  IF p_status IS NOT NULL
     AND p_status NOT IN ('te_verwerken', 'in_behandeling', 'verwerkt', 'vraag') THEN
    RAISE EXCEPTION 'unknown_status' USING ERRCODE = '22023';
  END IF;

  -- A question without words is the problem this feature replaces: the client would see THAT
  -- something is wrong and not WHAT. Refused, so a status is never written without its text.
  IF p_status = 'vraag' AND v_question IS NULL THEN
    RAISE EXCEPTION 'question_required' USING ERRCODE = '22023';
  END IF;

  -- Scope 1: the accountant is linked to this client. Re-checked here so that the function is
  -- safe on its own, whatever the caller verified.
  IF NOT EXISTS (
    SELECT 1 FROM public.accountant_clients ac
    WHERE ac.accountant_id = p_accountant_id AND ac.zzper_id = p_client_id
  ) THEN
    RAISE EXCEPTION 'not_linked' USING ERRCODE = '42501';
  END IF;

  -- Scope 2: the invoice belongs to this client. Locked, so two door calls on the same invoice
  -- serialise instead of interleaving.
  SELECT i.accountant_status INTO v_prev
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND (i.sender_id = p_client_id OR i.receiver_id = p_client_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_this_client' USING ERRCODE = '42501';
  END IF;

  -- The accountant's own question row on this invoice, if there is one. Locked for the same reason.
  SELECT s.status INTO v_qprev
  FROM public.accountant_subject_status s
  WHERE s.accountant_id = p_accountant_id
    AND s.subject_type = 'invoice'
    AND s.subject_id = p_invoice_id
  FOR UPDATE;

  -- Fact 1: the invoice's workflow status. Attribution (accountant_id) only on the lock, exactly
  -- as attributionFor() in the door decides it.
  UPDATE public.invoices
  SET accountant_status = p_status,
      accountant_id     = CASE WHEN p_status = 'verwerkt' THEN p_accountant_id ELSE NULL END
  WHERE id = p_invoice_id;

  -- Fact 2: the accountant's question row follows the same statement.
  IF p_status = 'vraag' THEN
    INSERT INTO public.accountant_subject_status
      (accountant_id, subject_type, subject_id, status, vraag_text, verwerkt_at, updated_at)
    VALUES
      (p_accountant_id, 'invoice', p_invoice_id, 'vraag', v_question, NULL, v_now)
    ON CONFLICT (accountant_id, subject_type, subject_id) DO UPDATE
      SET status      = 'vraag',
          vraag_text  = EXCLUDED.vraag_text,
          verwerkt_at = NULL,
          updated_at  = v_now;
    v_qstatus := 'vraag';
  ELSIF v_qprev IS NOT NULL THEN
    -- A row that exists mirrors the accountant's latest statement. Clearing the invoice status
    -- (p_status NULL) leaves the row in the neutral 'te_verwerken' — the question is no longer
    -- open, and the accountant's words stay in their archive (AV §7.4).
    UPDATE public.accountant_subject_status
    SET status      = coalesce(p_status, 'te_verwerken'),
        verwerkt_at = CASE WHEN p_status = 'verwerkt' THEN v_now ELSE NULL END,
        updated_at  = v_now
    WHERE accountant_id = p_accountant_id
      AND subject_type = 'invoice'
      AND subject_id = p_invoice_id;
    v_qstatus := coalesce(p_status, 'te_verwerken');
  ELSE
    v_qstatus := NULL;  -- no question row: nothing to move, nothing invented
  END IF;

  RETURN QUERY SELECT v_prev, coalesce(v_qprev = 'vraag', false), v_qstatus;
END $$;

COMMENT ON FUNCTION public.accountant_set_invoice_status(uuid, uuid, uuid, text, text) IS
  '[VRAAG-SYNC] The one write path for (invoices.accountant_status, the accountant''s own invoice question row): both move in one transaction, scoped to one accountant and one invoice. Server door only.';

-- ── EXECUTE: the four default grant paths, decided ───────────────────────────────────────────
-- PostgreSQL grants EXECUTE on a new function to PUBLIC; Supabase additionally grants anon,
-- authenticated and service_role by name (ALTER DEFAULT PRIVILEGES). Only the server may call
-- this: the client answers a question through /api/messages and never resolves one.
REVOKE ALL ON FUNCTION public.accountant_set_invoice_status(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accountant_set_invoice_status(uuid, uuid, uuid, text, text) TO service_role;

-- ── STATE CHECK ─────────────────────────────────────────────────────────────────────────────
-- SELECT to_regprocedure('public.accountant_set_invoice_status(uuid, uuid, uuid, text, text)') IS NOT NULL;  → true
-- SELECT has_function_privilege('anon', 'public.accountant_set_invoice_status(uuid, uuid, uuid, text, text)', 'EXECUTE');           → false
-- SELECT has_function_privilege('authenticated', 'public.accountant_set_invoice_status(uuid, uuid, uuid, text, text)', 'EXECUTE');  → false
-- SELECT has_function_privilege('service_role', 'public.accountant_set_invoice_status(uuid, uuid, uuid, text, text)', 'EXECUTE');   → true
