-- supabase/migrations/mandate_requires_accountant_role.sql
-- [EEN-POORT] Eén regel, één spelling: een mandaat telt alleen voor wie boekhouder ÍS.
--
-- ── DE AFWIJKING ────────────────────────────────────────────────────────────────────────────
--
-- Dezelfde vraag wordt op twee plaatsen beantwoord, en de antwoorden verschilden:
--
--   · TypeScript — resolveAccountantActing() weigert vóór alles als
--     `facts.callerRole !== 'accountant'`;
--   · SQL — has_active_invoice_mandate() keek alleen naar de mandaatrij, samengevoegd met
--     accountant_clients. Over profiles.role stond er niets.
--
-- Dat is precies het patroon dat de Identity & Access-specificatie verbiedt: één policy, meerdere
-- handhavingslagen — niet meerdere policies. Zolang de twee het eens waren merkte niemand het;
-- de dag waarop iemands rol verandert terwijl zijn koppelingen blijven staan, zijn het twee
-- verschillende antwoorden op één vraag.
--
-- ── WAT DAT CONCREET BETEKENT ───────────────────────────────────────────────────────────────
--
-- De functie wordt gebruikt in de UITZONDERINGSLIJST van drie triggers:
--
--     ... AND public.has_active_invoice_mandate(auth.uid(), OLD.sender_id)
--
-- oftewel: het bedragslot van de boekhouder laat door wie een levend factuurmandaat heeft. Een
-- mens die zijn boekhoudersrol verliest maar wiens accountant_clients- en mandaatrijen blijven
-- staan, behield daarmee de uitzondering — hij mocht bedragen wijzigen die het slot juist
-- beschermt.
--
-- ── DEZE WIJZIGING KAN ALLEEN MEER WEIGEREN ─────────────────────────────────────────────────
--
-- Er komt een voorwaarde bij; er verdwijnt er geen. De functie kan na deze migratie op geen
-- enkele invoer `true` teruggeven waar hij eerst `false` gaf. Dat is de veilige richting, en het
-- is de reden dat dit vanavond kan zonder dat er iets omvalt.
--
-- GEMETEN IN PRODUCTIE, 13 SEPTEMBER 2026: 0 mandaten, 3 boekhouderskoppelingen, 3 profielen met
-- rol 'accountant', en 0 levende mandaten in handen van iemand zonder die rol. De blast radius is
-- leeg. Over een jaar was dit een migratie geweest die iemand zijn toegang afneemt.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_active_invoice_mandate(
  p_accountant uuid,
  p_client     uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.accountant_invoice_mandates m
      JOIN public.accountant_clients ac
        ON ac.accountant_id = m.accountant_id
       AND ac.zzper_id      = m.zzper_id
      -- [EEN-POORT] De regel die alleen in TypeScript stond. Een mandaat is een afspraak MET een
      -- boekhouder; wie die rol niet (meer) heeft, heeft geen mandaat — hoe oud de rij ook is.
      JOIN public.profiles p
        ON p.id = m.accountant_id
       AND p.role = 'accountant'
     WHERE m.accountant_id = p_accountant
       AND m.zzper_id      = p_client
       AND m.kind          = 'facturen'
       AND m.revoked_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.has_active_invoice_mandate(uuid, uuid) IS
  '[EEN-POORT] Heeft deze boekhouder een LEVEND factuurmandaat van deze klant? Eist sinds september 2026 ook profiles.role = ''accountant'', omdat resolveAccountantActing() dat in TypeScript altijd al eiste en één vraag geen twee antwoorden mag hebben. Gebruikt in de uitzonderingslijst van de bedragsloten: wie hier false krijgt, valt onder het slot.';

COMMIT;

-- ── CONTROLE ────────────────────────────────────────────────────────────────────────────────
-- Moet waar zijn: de rolvoorwaarde staat in de functie.
SELECT prosrc LIKE '%p.role = ''accountant''%' AS mandate_requires_role
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'has_active_invoice_mandate';
