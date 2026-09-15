-- supabase/migrations/wachtkoppelingen.sql
-- [WACHTKOPPELING] "Ik heb dit betaald — de bank laat het over twee dagen zien."
--
-- Every existing link in this schema points at a row that already exists. bank_tx_attachments
-- carries `transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id)`, and that is
-- correct for what it does — but it is also the reason the app cannot hold the most ordinary
-- intention an owner has: the invoice is in hand, the payment is made, and the statement is two
-- days behind.
--
-- THE MISSING FOREIGN KEY IS THE POINT OF THIS TABLE. `transaction_id` here is nullable and
-- unconstrained until a real line arrives, at which point it is set and REFERENCES applies. A
-- waiting link is an intention; an intention that can only be stored once its object exists is
-- not an intention at all.
--
-- Nothing here books, pays or settles. When a bank line fits, the app PROPOSES and the owner
-- confirms — [ZELF-EERST] and [VOORSTEL]. A waiting link is the owner's memory, which is a weaker
-- witness than a read document, not a stronger one.
--
-- Additive and nullable throughout; an installation behind on this file keeps working exactly as
-- it does today.

CREATE TABLE IF NOT EXISTS public.wachtkoppelingen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'uit' = geld ging weg, 'in' = geld kwam binnen. Dutch because it is stored, per AGENTS.md.
  richting text NOT NULL CHECK (richting IN ('uit', 'in')),

  -- ALWAYS POSITIVE, whichever way the money went: the direction lives in `richting`, never in a
  -- sign. Two places carrying the same fact is how a sign error becomes invisible.
  bedrag numeric(12,2) NOT NULL CHECK (bedrag > 0),

  betaald_op date NOT NULL,
  tegenpartij text,

  -- The invoices this payment settles. An array rather than a join table because a waiting link is
  -- short-lived by construction and is never itself a booking: [SOM-KLOPT] already knows one
  -- payment can settle several invoices, and this only has to remember which ones the owner meant.
  factuur_ids uuid[] NOT NULL DEFAULT '{}',

  notitie text,

  -- 'wachtend'    — still looking
  -- 'voorgesteld' — a line was found and the owner has been asked
  -- 'gekoppeld'   — the owner confirmed; the booking happened through the ordinary doors
  -- 'verlopen'    — the window passed without a payment; it stops asking
  -- 'ingetrokken' — the owner withdrew it
  status text NOT NULL DEFAULT 'wachtend'
    CHECK (status IN ('wachtend', 'voorgesteld', 'gekoppeld', 'verlopen', 'ingetrokken')),

  -- [WACHTKOPPELING] The one column whose ABSENT foreign key is the feature. It is null while the
  -- payment has not arrived — which is the entire state this table exists to represent — and gets
  -- a real reference the moment it has.
  transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,

  -- [RITME] A banner that never goes away stops being a signal and becomes furniture. A link that
  -- never finds its payment says so and stops asking.
  verloopt_op date NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  -- A link that claims to be linked must name what it is linked to, and one that does not must not
  -- pretend. Enforced here rather than in the route, because a route is one door and a constraint
  -- is all of them.
  CONSTRAINT wachtkoppelingen_gekoppeld_heeft_regel
    CHECK (status <> 'gekoppeld' OR transaction_id IS NOT NULL)
);

-- The hot read: this owner's links that are still looking, oldest first.
CREATE INDEX IF NOT EXISTS wachtkoppelingen_open_idx
  ON public.wachtkoppelingen (user_id, betaald_op)
  WHERE status IN ('wachtend', 'voorgesteld');

CREATE INDEX IF NOT EXISTS wachtkoppelingen_tx_idx
  ON public.wachtkoppelingen (transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE public.wachtkoppelingen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wachtkoppelingen_owner_read ON public.wachtkoppelingen;
CREATE POLICY wachtkoppelingen_owner_read ON public.wachtkoppelingen
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS wachtkoppelingen_owner_write ON public.wachtkoppelingen;
CREATE POLICY wachtkoppelingen_owner_write ON public.wachtkoppelingen
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS wachtkoppelingen_owner_update ON public.wachtkoppelingen;
CREATE POLICY wachtkoppelingen_owner_update ON public.wachtkoppelingen
  FOR UPDATE TO authenticated USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

COMMENT ON TABLE public.wachtkoppelingen IS
  '[WACHTKOPPELING] Een betaling die de eigenaar al deed en die de bank nog niet liet zien. De ONTBREKENDE foreign key op transaction_id is het punt: een intentie die je pas kunt opslaan als haar object bestaat, is geen intentie. Boekt niets — stelt voor, de eigenaar bevestigt.';
