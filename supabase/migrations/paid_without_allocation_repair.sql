-- supabase/migrations/paid_without_allocation_repair.sql
-- [EEN-SCHRIJFPAD] De 26 rijen die de twee lekken hebben achtergelaten, hersteld.
--
-- ── WAT ER STOND, GEMETEN OP 13 SEPTEMBER 2026 ──────────────────────────────────────────────
--
-- 441 betaalde facturen. Zesentwintig ervan braken het enige geldbeginsel dat deze app heeft:
--
--     invoices.amount_paid = SUM(bank_tx_invoices.amount_applied)
--
--   A. 13 facturen: 'paid', een bedrag (samen € 10.192,14), en GEEN toewijzingsrij.
--   B.  5 facturen: 'paid', amount_paid 0, en geen toewijzingsrij.
--   C.  8 facturen: toewijzingsrijen voor € 4.138,57, en amount_paid 0.
--
-- A en B komen van /api/email/confirm/[id] (de bevestigingswachtrij schreef 'betaald' zonder
-- koppeling); C is één dag in september waarop koppelingen zijn geschreven zonder dat de
-- cachekolom meeliep. De code-lekken zijn dicht — dit bestand ruimt op wat ze achterlieten.
--
-- ── WAAROM DIT VEILIG IS, EN WAAROM HET TWEE VERSCHILLENDE SCHRIJFACTIES ZIJN ────────────────
--
-- Gemeten vóór het schrijven: alle 26 dragen een payment_date én een payment_method, geen van
-- alle staat op 'verwerkt' bij de boekhouder, en bij groep A is amount_paid AL exact gelijk aan
-- het totaal. Er valt hier dus niets te schatten.
--
--   · STAP 1 is een HERHALING van wat de factuurrij zelf al beweert. De rij zegt: betaald, met
--     deze methode, op deze dag. De toewijzingsrij zegt precies dat en niets meer. Er wordt geen
--     bedrag verzonnen: 'paid' betekent volledig voldaan, en bij A is amount_paid dat bedrag al.
--   · STAP 2 is een AFLEIDING, geen bewering. recompute_invoice_amount_paid telt de overlevende
--     koppelingen op — dezelfde functie die elke terugdraaiing gebruikt. Voor groep C is dat het
--     hele herstel; voor B trekt hij de cachekolom recht die stap 1 zojuist waar heeft gemaakt.
--
-- Wat hier NIET gebeurt: geen status verandert, geen datum, geen methode, geen bedrag op de
-- factuur dat al klopte. Er wordt niets betaald en niets teruggedraaid.
--
-- ── IDEMPOTENT ZONDER SLEUTEL ───────────────────────────────────────────────────────────────
--
-- client_key blijft NULL. Een idempotentiesleutel bestaat voor een CLIENT die opnieuw belt; hier
-- is geen client. Het bestand is herhaalbaar doordat stap 1 alleen invoegt waar nog geen enkele
-- koppeling staat — draai hem twee keer en de tweede keer raakt hij nul rijen.

BEGIN;

-- ── STAP 1 — de ontbrekende toewijzingsrij, voor elke betaalde factuur zonder koppeling ──────
-- transaction_id NULL = handmatig geboekt, precies zoals apply_manual_payment het schrijft.
-- paid_on draagt de dag, zodat een kasstelselkwartaal hem kan plaatsen; method zegt de kasboek
-- of het contant was.
INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied, paid_on, method)
SELECT coalesce(i.sender_id, i.receiver_id),
       NULL,
       i.id,
       abs(coalesce(i.total_inc_btw, 0)),
       i.payment_date,
       CASE WHEN i.payment_method IN ('bank', 'kas') THEN i.payment_method ELSE 'bank' END
FROM public.invoices i
WHERE i.status = 'paid'
  AND i.payment_date IS NOT NULL
  AND abs(coalesce(i.total_inc_btw, 0)) > 0
  AND coalesce(i.accountant_status, '') <> 'verwerkt'
  AND coalesce(i.sender_id, i.receiver_id) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.bank_tx_invoices l WHERE l.invoice_id = i.id);

-- ── STAP 2 — de cachekolom opnieuw afleiden waar hij de koppelingen niet volgt ───────────────
-- Door de functie die er al de eigenaar van is, niet met een eigen SUM: twee plekken die
-- amount_paid berekenen is precies hoe ze uit elkaar gaan lopen.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id, coalesce(i.sender_id, i.receiver_id) AS owner_id
    FROM public.invoices i
    WHERE coalesce(i.sender_id, i.receiver_id) IS NOT NULL
      AND coalesce(i.accountant_status, '') <> 'verwerkt'
      AND abs(coalesce(i.amount_paid, 0) - (
            SELECT coalesce(sum(coalesce(l.amount_applied, 0)), 0)
            FROM public.bank_tx_invoices l WHERE l.invoice_id = i.id
          )) > 0.01
  LOOP
    PERFORM public.recompute_invoice_amount_paid(r.owner_id, r.id);
  END LOOP;
END $$;

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Beide moeten 0 zijn.
SELECT count(*) AS paid_without_allocation
  FROM public.invoices i
 WHERE i.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM public.bank_tx_invoices l WHERE l.invoice_id = i.id);
SELECT count(*) AS cache_disagrees_with_links
  FROM public.invoices i
 WHERE abs(coalesce(i.amount_paid, 0) - (
         SELECT coalesce(sum(coalesce(l.amount_applied, 0)), 0)
         FROM public.bank_tx_invoices l WHERE l.invoice_id = i.id
       )) > 0.01;
