-- supabase/migrations/clients_default_hourly_rate.sql
-- [TARIEF-KLANT] The rate agreed with THIS customer.
--
-- The hourly rate was typed per hour. A consultant with four customers has four rates and the
-- field is optional — so the most-shown signal in the whole app ("hours with no rate fall outside
-- the invoice") is born at exactly that empty field. This removes the cause instead of the warning.
--
-- Fills an EMPTY rate only. What the owner types always wins: an hour at a different rate is an
-- agreement, not a mistake.
--
-- Additive and nullable, and the app writes it in its own optional step, so an installation behind
-- on this file keeps saving customers.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS default_hourly_rate numeric(10,2)
  CHECK (default_hourly_rate IS NULL OR default_hourly_rate >= 0);
COMMENT ON COLUMN public.clients.default_hourly_rate IS
  '[TARIEF-KLANT] The rate agreed with THIS customer, ex btw. Fills an empty rate when an hour is written for them; never overwrites what the owner typed. Null = no rate agreed.';
