-- migrations: fair_use_usage.sql, ontvangen_fair_use_per_document.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] One received document costs at most one aiDocument — against a real PostgreSQL.
-- Run: npm run test:sql
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- The TypeScript test for this contract asserts against a fake that implements the rules I
-- believe the SQL has. That proves the caller, not the function. The whole reason this function
-- exists is a crash BETWEEN two writes, and the only thing that can prove those two writes are
-- one write is a database that actually runs them.
--
-- The failure being prevented:
--     fair_use_consume succeeds  → counter +1
--     the process dies           → no catch, no finally, no release
--     the drain retries          → counter +1 again
-- Nothing in the application can see that. Only a durable mark, written in the same transaction
-- as the increment, can.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_eq(what text, got numeric, want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

CREATE OR REPLACE FUNCTION public.t_is(what text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, coalesce(got, 'null');
END $$;

DO $$
DECLARE
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_doc  uuid := '22222222-2222-2222-2222-222222222222';
  v_doc2 uuid := '33333333-3333-3333-3333-333333333333';
  v_other uuid := '44444444-4444-4444-4444-444444444444';
  r      record;
BEGIN
  INSERT INTO public.profiles (id) VALUES (v_user), (v_other);
  INSERT INTO public.documents (id, user_id) VALUES (v_doc, v_user), (v_doc2, v_user);

  -- ── 1. The first reservation moves the counter AND marks the document, in one step ──────────
  SELECT * INTO r FROM public.fair_use_consume_for_document(v_user, v_doc, '2026-09', 50);
  PERFORM public.t_is('first reservation is allowed', r.allowed::text, 'true');
  PERFORM public.t_is('…and is not a replay',         r.replayed::text, 'false');
  PERFORM public.t_eq('…the counter moved',           r.used, 1);

  PERFORM public.t_is('the document carries the period it paid in',
                      (SELECT intake_ai_counted_period FROM public.documents WHERE id = v_doc), '2026-09');

  -- ── 2. THE CRASH. No release ran. The drain comes back — four times. ────────────────────────
  FOR i IN 1..4 LOOP
    SELECT * INTO r FROM public.fair_use_consume_for_document(v_user, v_doc, '2026-09', 50);
    PERFORM public.t_is('a retry after a crash is allowed', r.allowed::text, 'true');
    PERFORM public.t_is('…and says so: it is a replay',     r.replayed::text, 'true');
  END LOOP;
  PERFORM public.t_eq('after four retries the month still shows ONE document',
                      (SELECT count FROM public.usage_counters
                        WHERE user_id = v_user AND period = '2026-09' AND metric = 'aiDocuments'), 1);

  -- ── 3. A new month does not re-charge the same document ────────────────────────────────────
  -- 30 September reserved, crash, 1 October the drain returns. The calendar changing is not a
  -- reason to bill the same file again — which is why the PERIOD is stored, not a flag.
  SELECT * INTO r FROM public.fair_use_consume_for_document(v_user, v_doc, '2026-10', 50);
  PERFORM public.t_is('October answers replay', r.replayed::text, 'true');
  PERFORM public.t_eq('…and October was never touched',
                      (SELECT coalesce(sum(count), 0) FROM public.usage_counters
                        WHERE user_id = v_user AND period = '2026-10'), 0);

  -- ── 4. A refusal reserves nothing, so there is nothing to give back ────────────────────────
  UPDATE public.usage_counters SET count = 50
   WHERE user_id = v_user AND period = '2026-09' AND metric = 'aiDocuments';
  SELECT * INTO r FROM public.fair_use_consume_for_document(v_user, v_doc2, '2026-09', 50);
  PERFORM public.t_is('a full month refuses', r.allowed::text, 'false');
  PERFORM public.t_is('…and leaves no mark',
                      coalesce((SELECT intake_ai_counted_period FROM public.documents WHERE id = v_doc2), 'null'), 'null');
  PERFORM public.t_eq('…and moves nothing',
                      (SELECT count FROM public.usage_counters
                        WHERE user_id = v_user AND period = '2026-09' AND metric = 'aiDocuments'), 50);

  -- ── 5. The release gives back the month it was TAKEN in ────────────────────────────────────
  -- Reserved in September, released in October. Decrementing October would leave both months wrong.
  SELECT * INTO r FROM public.fair_use_release_for_document(v_user, v_doc);
  PERFORM public.t_is('the release names the stored period', r.period, '2026-09');
  PERFORM public.t_eq('…and September came down by one',
                      (SELECT count FROM public.usage_counters
                        WHERE user_id = v_user AND period = '2026-09' AND metric = 'aiDocuments'), 49);
  PERFORM public.t_is('…and the mark is gone',
                      coalesce((SELECT intake_ai_counted_period FROM public.documents WHERE id = v_doc), 'null'), 'null');

  -- ── 6. A double release cannot mint free credit ────────────────────────────────────────────
  SELECT * INTO r FROM public.fair_use_release_for_document(v_user, v_doc);
  PERFORM public.t_is('the second release finds nothing', r.released::text, 'false');
  PERFORM public.t_eq('…and the counter did not fall again',
                      (SELECT count FROM public.usage_counters
                        WHERE user_id = v_user AND period = '2026-09' AND metric = 'aiDocuments'), 49);

  -- ── 7. Another owner's document reserves nothing at all ────────────────────────────────────
  -- RLS is off on this line; the predicate inside the function is the whole boundary.
  BEGIN
    SELECT * INTO r FROM public.fair_use_consume_for_document(v_other, v_doc, '2026-09', 50);
    RAISE EXCEPTION 'FAIL · a stranger reserved against someone else''s document';
  EXCEPTION WHEN sqlstate '55000' THEN
    RAISE NOTICE '  ok · a stranger is refused outright';
  END;
  PERFORM public.t_eq('…and nobody else''s counter moved',
                      (SELECT coalesce(sum(count), 0) FROM public.usage_counters WHERE user_id = v_other), 0);

  RAISE NOTICE '✅ [ONTVANGEN] one document, at most one aiDocument — across crashes and months.';
END $$;

-- ── WIE MAG DEZE FUNCTIES AANROEPEN ─────────────────────────────────────────────────────────
--
-- PostgreSQL geeft EXECUTE op een nieuwe functie standaard aan PUBLIC, en een GRANT aan
-- service_role haalt dat er niet af. Deze twee zijn SECURITY DEFINER en nemen p_user_id als
-- argument: wie ze mag aanroepen, mag namens iedere gebruiker tellen en teruggeven. Het verschil
-- tussen "wij hebben service_role een recht gegeven" en "alleen service_role heeft dat recht" is
-- precies één REVOKE, en die is met het blote oog niet te zien — dus wordt hij hier per rol
-- nagerekend in plaats van aangenomen.
--
-- ── EN WAAROM DIT BLOK ALLEEN WERKT MET DE FIXTURE ──────────────────────────────────────────
--
-- Deze vier regels stonden er al en waren groen terwijl PRODUCTIE openstond. Niet omdat ze het
-- verkeerde vroegen, maar omdat ze het in een wereld vroegen waarin het antwoord niet anders KON
-- zijn: op een kale PostgreSQL erven anon en authenticated hun EXECUTE via PUBLIC, dus een
-- `REVOKE ... FROM PUBLIC` haalt die er vanzelf af. Supabase geeft ze een DIRECTE toekenning via
-- ALTER DEFAULT PRIVILEGES, en daar doet die REVOKE niets aan.
--
-- tests/sql/fixture.sql bootst dat standaardrecht nu na. HAAL DIE REGEL NIET WEG: zonder haar
-- slaagt dit blok weer altijd, en is het een vinkje in plaats van een bewijs. Gemeten: met de
-- fixture en een migratie die alleen van PUBLIC revoket faalt dit blok (exit 1); zonder de
-- fixture slaagt diezelfde kapotte migratie (exit 0).
DO $$
DECLARE
  v_consume constant text := 'public.fair_use_consume_for_document(uuid, uuid, text, integer)';
  v_release constant text := 'public.fair_use_release_for_document(uuid, uuid)';
  v_role    text;
  v_fn      text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[v_consume, v_release] LOOP
    -- De browser-rollen: allebei geweigerd. Dit zijn geen publieke API's.
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL · % mag % aanroepen — een SECURITY DEFINER functie met p_user_id hoort niet vanaf de browser bereikbaar te zijn', v_role, v_fn;
      END IF;
      RAISE NOTICE '  ok · % mag % NIET aanroepen', v_role, split_part(v_fn, '(', 1);
    END LOOP;

    -- En de server wél, anders is de grens een muur zonder deur.
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL · service_role mag % NIET aanroepen — dan kan niets de reservering doen', v_fn;
    END IF;
    RAISE NOTICE '  ok · service_role mag % wel aanroepen', split_part(v_fn, '(', 1);

    -- PUBLIC is waar het standaardrecht vandaan komt; dat het weg is, is de hele REVOKE.
    IF has_function_privilege('public', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL · PUBLIC mag % nog steeds aanroepen — de REVOKE ontbreekt of staat na de GRANT', v_fn;
    END IF;
    RAISE NOTICE '  ok · PUBLIC heeft geen recht meer op %', split_part(v_fn, '(', 1);
  END LOOP;

  RAISE NOTICE '✅ [ONTVANGEN] alleen de server mag deze twee aanroepen.';
END $$;
