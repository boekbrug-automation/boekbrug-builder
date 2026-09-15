-- =====================================================================
-- [RITTEN] The kilometre log — the deduction a zzp'er forgets, and the travel they never bill.
-- =====================================================================
-- WHY
--
-- A dienstverlener drives to customers in their own car. Two amounts follow from that, and both
-- go missing for the same reason: nobody writes the trip down on the day it happened.
--
--   · The deduction. Business kilometres in a private car are worth € 0,23 each off the profit
--     (2026). A consultant with two customer visits a week at 40 km is 4.000 km a year — around
--     € 920 of profit that is taxed because the trips were never recorded. The Belastingdienst
--     asks for a log: the date, where from, where to, the purpose, the distance.
--   · The travel that was agreed with the customer and never reached an invoice.
--
-- Both need exactly one thing: a row per trip, written on the day.
--
-- WHAT THIS IS
--
-- The same shape as time_entries, deliberately. A trip is a piece of work with a date, a customer
-- and a number, and the one column that carries the whole point is `invoice_id`: a trip that is
-- on an invoice POINTS at that invoice, so "what have I not billed yet" is a column and not a
-- calculation, and the same trip cannot go out twice.
--
-- ON DELETE SET NULL for the same reason as the hours: throw away a concept invoice and those
-- kilometres are billable again — they were still driven.
--
-- WHAT THIS IS NOT
--
-- No GPS, no route planner, no distance lookup, no company-car regime with a 500-kilometre rule.
-- Those belong to a fleet; this is one entrepreneur writing down that they drove to Zwolle.
--
-- SHIPS DARK. Every existing account has zero rows here. No amount, no aangifte and no existing
-- screen moves because this migration ran: nothing reads it until the owner logs a first trip.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mileage_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- profiles(id), like time_entries, cash_entries and articles. A table that anchors somewhere
  -- else is a table that drifts at the first join.
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Who it was for. NULL is allowed: a drive to the wholesaler is a business kilometre with no
  -- customer behind it, and refusing it would make the owner do administration before they may
  -- write down what they did.
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- [TZ] The day of the trip in the owner's own calendar, so a DATE and never a timestamp.
  driven_on   date NOT NULL,

  -- Where from and where to. The Belastingdienst asks for both in a kilometre log, and they are
  -- also what makes a row recognisable a year later. Free text: "kantoor", "huis", a full address
  -- — whatever the owner writes is what the log says.
  from_place  text NOT NULL CHECK (btrim(from_place) <> ''),
  to_place    text NOT NULL CHECK (btrim(to_place) <> ''),

  -- Why. This becomes the invoice line's description when the trip is billed, so it is what the
  -- CUSTOMER reads. Required: an amount without a reason is not an invoice line.
  purpose     text NOT NULL CHECK (btrim(purpose) <> ''),

  -- How far. numeric(8,1): one decimal, up to 9.999.999,9 km. Strictly positive — a trip of zero
  -- kilometres is not a trip, and a negative one is a correction that belongs in its own row.
  kilometers  numeric(8,1) NOT NULL CHECK (kilometers > 0 AND kilometers <= 5000),

  -- What the CUSTOMER pays per kilometre, ex btw. NULL = this trip is not being charged on: the
  -- ordinary case for a drive to the wholesaler, and for travel that is inside the agreed price.
  -- Zero is allowed and means something else (travel offered free) — hence no CHECK on > 0.
  --
  -- The DEDUCTION is not this number. What the Belastingdienst allows per business kilometre is a
  -- rate set by law, and it is applied where the year is computed, never stored per row: a rate
  -- frozen into 4.000 rows is a rate nobody can change when the law does.
  rate_per_km numeric(6,3) CHECK (rate_per_km IS NULL OR rate_per_km >= 0),

  -- Business or private. Only an explicit false takes a trip out of the log: a row written before
  -- anyone thought about the column is a business trip, which is the only kind that gets written
  -- down here in the first place.
  business    boolean NOT NULL DEFAULT true,

  -- [RITTEN-EENMALIG] The rule of this file. Filled = these kilometres are on that invoice and
  -- out of the billable stock. Empty = still to bill. A column that POINTS, never a derivation.
  invoice_id  uuid REFERENCES public.invoices(id) ON DELETE SET NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mileage_entries ENABLE ROW LEVEL SECURITY;

-- Own rows and nothing else — the same four policies as time_entries.
DROP POLICY IF EXISTS mileage_entries_select_own ON public.mileage_entries;
CREATE POLICY mileage_entries_select_own ON public.mileage_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS mileage_entries_insert_own ON public.mileage_entries;
CREATE POLICY mileage_entries_insert_own ON public.mileage_entries
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS mileage_entries_update_own ON public.mileage_entries;
CREATE POLICY mileage_entries_update_own ON public.mileage_entries
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS mileage_entries_delete_own ON public.mileage_entries;
CREATE POLICY mileage_entries_delete_own ON public.mileage_entries
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- The question the screen asks every time: my trips, newest first.
CREATE INDEX IF NOT EXISTS idx_mileage_entries_owner
  ON public.mileage_entries (user_id, driven_on DESC);

-- And the reverse question: which trips are in THIS invoice.
CREATE INDEX IF NOT EXISTS idx_mileage_entries_invoice
  ON public.mileage_entries (invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON TABLE public.mileage_entries IS
  '[RITTEN] One row per business trip: date, from, to, purpose, kilometres. Feeds the year''s kilometre deduction and, where a rate is set, the travel billed to a customer.';
